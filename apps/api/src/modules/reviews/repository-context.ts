import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import {
  Output,
  ToolLoopAgent,
  tool,
  type LanguageModel,
  type ToolLoopAgentSettings,
} from "ai"
import {
  getSymbolCallers,
  getSymbolDefinition,
  readRepositoryFile,
  searchRepositoryText,
  type RepositoryCodeIndex,
} from "tools"
import { z } from "zod"
import { db } from "../../db/client"
import {
  repository,
  repositoryContext,
  type pullRequest,
} from "../../db/schema"
import type { ReviewRunRecorder } from "./debug-run"

type Repository = typeof repository.$inferSelect
type PullRequest = typeof pullRequest.$inferSelect

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
  error: (message: string, details?: Record<string, unknown>) => void
}

type ProviderOptions = ToolLoopAgentSettings["providerOptions"]

const repositoryContextOutputSchema = z.object({
  summary: z.string().min(1),
  markdown: z.string().min(1),
})

const architectureImpactSchema = z.object({
  changesArchitecture: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  changedAreas: z.array(z.string()).default([]),
})

export type PreparedRepositoryContext = {
  markdown: string
  summary: string
  source: "generated" | "reused"
  contextId: string
  baseSha: string
  architectureImpact: z.infer<typeof architectureImpactSchema>
}

const toolText = (text: string, maxBytes = 90_000) => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  let output = text
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, Math.floor(output.length * 0.9))
  }
  return `${output}\n\n[truncated]`
}

const textBytes = (text: string) => Buffer.byteLength(text, "utf8")

const moduleKeyForFile = (file: string) => {
  const parts = file.split("/")
  if (parts[0] === "apps" && parts.length >= 2)
    return parts.slice(0, 2).join("/")
  if (parts[0] === "packages" && parts.length >= 2) {
    return parts.slice(0, 2).join("/")
  }
  if (parts.length >= 2) return parts.slice(0, 2).join("/")
  return parts[0] ?? file
}

const compactFileTree = (files: string[]) => {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const key = moduleKeyForFile(file)
    groups.set(key, [...(groups.get(key) ?? []), file])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 80)
    .map(([path, groupFiles]) => ({
      path,
      fileCount: groupFiles.length,
      examples: groupFiles.slice(0, 8),
    }))
}

const buildArchitectureSnapshot = ({
  index,
}: {
  index: RepositoryCodeIndex
}) => {
  const fileModules = compactFileTree(index.repositoryFiles)

  const callerCounts = new Map<string, number>()
  for (const edge of index.graph.edges) {
    callerCounts.set(
      edge.calleeSymbolId,
      (callerCounts.get(edge.calleeSymbolId) ?? 0) + 1
    )
  }
  const symbolsById = new Map(
    index.graph.symbols.map((symbol) => [symbol.id, symbol])
  )
  const highFanInSymbols = [...callerCounts.entries()]
    .map(([symbolId, callers]) => ({
      symbol: symbolsById.get(symbolId),
      callers,
    }))
    .filter(
      (
        item
      ): item is {
        symbol: NonNullable<typeof item.symbol>
        callers: number
      } => Boolean(item.symbol)
    )
    .sort((a, b) => b.callers - a.callers)
    .slice(0, 30)
    .map(({ symbol, callers }) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      exported: symbol.exported,
      callers,
    }))

  const entrypointPattern =
    /(^app$|routes?$|router$|handler$|server$|main$|worker$|job|command|controller|schema|config)/i
  const entrypoints = index.graph.symbols
    .filter(
      (symbol) =>
        symbol.exported &&
        (entrypointPattern.test(symbol.name) ||
          /(^src\/index|\/routes?\/|\/app\/|\/jobs?\/|\/workers?\/|\/commands?\/)/.test(
            symbol.file
          ))
    )
    .slice(0, 80)
    .map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
    }))

  const moduleDependencies = new Map<string, Set<string>>()
  for (const dependency of index.graph.dependencies) {
    if (!dependency.resolved || !dependency.to) continue
    const from = moduleKeyForFile(dependency.from)
    const to = moduleKeyForFile(dependency.to)
    if (from === to) continue
    moduleDependencies.set(
      from,
      new Set([...(moduleDependencies.get(from) ?? []), to])
    )
  }

  return {
    detectedLanguages: index.detectedLanguages,
    repositoryFiles: index.repositoryFiles.length,
    parsedFiles: index.files.length,
    fileModules,
    totalFileModuleGroups: new Set(index.repositoryFiles.map(moduleKeyForFile))
      .size,
    entrypoints,
    highFanInSymbols,
    moduleDependencies: [...moduleDependencies.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([from, to]) => ({ from, to: [...to].sort() })),
    diagnostics: index.diagnostics.slice(0, 50),
  }
}

const createRepositoryTools = ({
  repositoryPath,
  index,
  recorder,
}: {
  repositoryPath: string
  index: RepositoryCodeIndex
  recorder: ReviewRunRecorder
}) => ({
  read_file: tool({
    description:
      "Returns numbered lines from a repository file by repo-relative path. Use for a small explicit range when summarizing architecture needs source context.",
    inputSchema: z.object({
      file: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().max(200).optional(),
    }),
    execute: async ({ file, startLine, maxLines }) => {
      const input = { file, startLine, maxLines }
      const output = await readRepositoryFile({
        repository: repositoryPath,
        file,
        startLine,
        maxLines,
      })
      await recorder.recordToolCall({
        name: "repository_context.read_file",
        input,
        output,
      })
      return output
    },
  }),
  get_symbol_definition: tool({
    description:
      "Returns matching symbol definitions with signature, file/line range, enclosing scope metadata, and definition source.",
    inputSchema: z.object({
      symbol: z.string().min(1),
    }),
    execute: async ({ symbol }) => {
      const input = { symbol }
      const result = await getSymbolDefinition({
        repository: repositoryPath,
        index,
        symbol,
      })
      const output = { ...result.json, stats: result.stats }
      await recorder.recordToolCall({
        name: "repository_context.get_symbol_definition",
        input,
        output,
      })
      return output
    },
  }),
  get_symbol_callers: tool({
    description:
      "Returns direct call locations and enclosing caller metadata for a symbol.",
    inputSchema: z.object({
      symbol: z.string().min(1),
    }),
    execute: async ({ symbol }) => {
      const input = { symbol }
      const result = await getSymbolCallers({
        repository: repositoryPath,
        index,
        symbol,
      })
      const output = { ...result.json, stats: result.stats }
      await recorder.recordToolCall({
        name: "repository_context.get_symbol_callers",
        input,
        output,
      })
      return output
    },
  }),
  locate_text: tool({
    description:
      "Finds exact strings, identifiers, route paths, config keys, table names, imports, or error strings across indexed repository files.",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    execute: async ({ query }) => {
      const input = { query }
      const result = await searchRepositoryText({
        repository: repositoryPath,
        index,
        query,
        maxResults: 50,
      })
      const output = {
        ...result.stats,
        markdown: toolText(result.markdown),
      }
      await recorder.recordToolCall({
        name: "repository_context.locate_text",
        input,
        output,
      })
      return output
    },
  }),
})

const repositoryContextInstructions = `Create a concise persistent repository context document.

The document must be markdown. It should help others understand the repository quickly and analyze it when needed.

Rules:
- Keep the document compact. Prefer high-signal summaries over exhaustive listings.
- Aim for 1,500-3,000 words. If the repository is large, summarize patterns instead of enumerating every module.
- Use concrete file paths and symbol names as evidence where possible.
- Do not invent facts. If architecture is unclear, say only what the indexed repository evidence supports.

Required markdown sections, in this exact order:
# Repository Context
## Repository Summary
## Repository Structure
## Main Modules
## Important Workflows
## Data And State
## Boundaries And Trust Model
## Local Conventions
## Critical Invariants
## External Integrations
## Architecture Snapshot

The Architecture Snapshot section may contain a compact JSON block, but the rest should be readable markdown.`

const buildRepositoryContextPrompt = ({
  repo,
  analyzedSha,
  architectureSnapshot,
}: {
  repo: Repository
  analyzedSha: string
  architectureSnapshot: unknown
}) => `Repository: ${repo.fullName}
Default branch: ${repo.defaultBranch ?? "(unknown)"}
Current analyzed base SHA: ${analyzedSha}

Deterministic architecture snapshot from the repository index:
${JSON.stringify(architectureSnapshot, null, 2)}

Create the persistent markdown repository context now. Use tools only if you need source details for important modules, workflows, state, boundaries, conventions, invariants, or integrations.`

const architectureImpactInstructions = `Decide whether a pull request materially changes the repository architecture context document.

Return changesArchitecture=true only when the persistent context should be regenerated because the PR changes high-level structure, main modules, important workflows, persistent state model.`

const buildArchitectureImpactPrompt = ({
  existingContext,
  diff,
  affectedSymbols,
  semanticCoverage,
}: {
  existingContext: string
  diff: string
  affectedSymbols: string
  semanticCoverage?: string | null
}) => `Existing repository context summary:
${existingContext}

Pull request diff:
${diff}

Changed symbol index:
${affectedSymbols}${
  semanticCoverage
    ? `

Semantic/index coverage:
${semanticCoverage}`
    : ""
}

Does this PR materially change the persistent repository context document?`

const generateRepositoryContext = async ({
  repo,
  pullRequest,
  repositoryPath,
  index,
  analyzedSha,
  model,
  modelId,
  providerOptions,
  recorder,
  logger,
  reason,
}: {
  repo: Repository
  pullRequest: PullRequest
  repositoryPath: string
  index: RepositoryCodeIndex
  analyzedSha: string
  model: LanguageModel
  modelId: string
  providerOptions?: ProviderOptions
  recorder: ReviewRunRecorder
  logger: Logger
  reason: string
}) => {
  const architectureSnapshot = buildArchitectureSnapshot({ index })
  const prompt = buildRepositoryContextPrompt({
    repo,
    analyzedSha,
    architectureSnapshot,
  })
  await recorder.writeText(
    "context/repository-context-instructions.txt",
    repositoryContextInstructions
  )
  await recorder.writeJson(
    "context/repository-context-architecture-snapshot.json",
    architectureSnapshot
  )
  await recorder.writeText("context/repository-context-prompt.txt", prompt)
  await recorder.writeJson("context/repository-context-prompt-stats.json", {
    promptBytes: textBytes(prompt),
    architectureSnapshotBytes: textBytes(JSON.stringify(architectureSnapshot)),
    reason,
    modelId,
  })

  logger.info("Repository context generation started", {
    repositoryId: repo.id,
    repository: repo.fullName,
    reviewRunId: recorder.runPath,
    modelId,
    reason,
  })
  await recorder.appendEvent("repository_context.generation.started", {
    modelId,
    reason,
  })

  const agent = new ToolLoopAgent({
    model,
    instructions: repositoryContextInstructions,
    tools: createRepositoryTools({ repositoryPath, index, recorder }),
    providerOptions,
    output: Output.object({
      schema: repositoryContextOutputSchema,
      name: "repository_context",
      description: "Persistent markdown repository context",
    }),
    maxRetries: 2,
    onStepFinish: async (step) => {
      await recorder.recordStep(step)
    },
  })
  const generation = await agent.generate({ prompt })
  const output = repositoryContextOutputSchema.parse(generation.output)
  await recorder.writeJson("repository-context-generation-output.json", {
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    providerMetadata: generation.providerMetadata,
    output: generation.output,
    text: generation.text,
  })
  await recorder.writeText("context/repository-context.md", output.markdown)
  await recorder.writeJson("context/repository-context-stats.json", {
    markdownBytes: textBytes(output.markdown),
    summaryBytes: textBytes(output.summary),
    modelId,
    baseSha: analyzedSha,
    reason,
  })
  await recorder.appendEvent("repository_context.generation.completed", {
    modelId,
    reason,
    markdownBytes: textBytes(output.markdown),
    summaryBytes: textBytes(output.summary),
  })
  logger.info("Repository context generation completed", {
    repositoryId: repo.id,
    repository: repo.fullName,
    modelId,
    reason,
    markdownBytes: textBytes(output.markdown),
  })

  const values = {
    id: randomUUID(),
    repositoryId: repo.id,
    baseSha: analyzedSha,
    modelId,
    markdown: output.markdown,
    summary: output.summary,
    metadata: {
      reason,
      generatedDuringPullRequestId: pullRequest.id,
      generatedDuringPullRequestNumber: pullRequest.number,
      architectureSnapshot,
      usage: generation.totalUsage,
      providerMetadata: generation.providerMetadata,
    },
    generatedAt: new Date(),
  }
  const [saved] = await db
    .insert(repositoryContext)
    .values(values)
    .onConflictDoUpdate({
      target: repositoryContext.repositoryId,
      set: {
        baseSha: values.baseSha,
        modelId: values.modelId,
        markdown: values.markdown,
        summary: values.summary,
        metadata: values.metadata,
        generatedAt: values.generatedAt,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!saved) throw new Error("Failed to save repository context")
  await recorder.writeJson("context/repository-context-db-row.json", saved)
  return saved
}

const classifyArchitectureImpact = async ({
  existingContext,
  diff,
  affectedSymbols,
  semanticCoverage,
  model,
  modelId,
  providerOptions,
  recorder,
  logger,
  repo,
}: {
  existingContext: string
  diff: string
  affectedSymbols: string
  semanticCoverage?: string | null
  model: LanguageModel
  modelId: string
  providerOptions?: ProviderOptions
  recorder: ReviewRunRecorder
  logger: Logger
  repo: Repository
}) => {
  const prompt = buildArchitectureImpactPrompt({
    existingContext,
    diff,
    affectedSymbols,
    semanticCoverage,
  })
  await recorder.writeText(
    "context/repository-context-impact-instructions.txt",
    architectureImpactInstructions
  )
  await recorder.writeText(
    "context/repository-context-impact-prompt.txt",
    prompt
  )
  await recorder.writeJson(
    "context/repository-context-impact-prompt-stats.json",
    {
      promptBytes: textBytes(prompt),
      existingContextBytes: textBytes(existingContext),
      diffBytes: textBytes(diff),
      affectedSymbolsBytes: textBytes(affectedSymbols),
      semanticCoverageBytes: semanticCoverage ? textBytes(semanticCoverage) : 0,
      modelId,
    }
  )
  await recorder.appendEvent("repository_context.impact.started", { modelId })
  logger.info("Repository context architecture impact classification started", {
    repositoryId: repo.id,
    repository: repo.fullName,
    modelId,
  })

  const agent = new ToolLoopAgent({
    model,
    instructions: architectureImpactInstructions,
    providerOptions,
    output: Output.object({
      schema: architectureImpactSchema,
      name: "repository_context_architecture_impact",
      description: "Whether a PR should regenerate repository context",
    }),
    maxRetries: 2,
    onStepFinish: async (step) => {
      await recorder.recordStep(step)
    },
  })
  const generation = await agent.generate({ prompt })
  const impact = architectureImpactSchema.parse(generation.output)
  await recorder.writeJson("repository-context-impact-output.json", {
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    providerMetadata: generation.providerMetadata,
    output: generation.output,
    text: generation.text,
  })
  await recorder.writeJson("context/repository-context-impact.json", impact)
  await recorder.appendEvent("repository_context.impact.completed", impact)
  logger.info(
    "Repository context architecture impact classification completed",
    {
      repositoryId: repo.id,
      repository: repo.fullName,
      modelId,
      changesArchitecture: impact.changesArchitecture,
      confidence: impact.confidence,
    }
  )
  return impact
}

export const prepareRepositoryContextForReview = async ({
  repo,
  pullRequest,
  baseRepositoryPath,
  baseIndex,
  baseSha,
  diff,
  affectedSymbols,
  semanticCoverage,
  contextModel,
  contextModelId,
  classifierModel,
  classifierModelId,
  contextProviderOptions,
  classifierProviderOptions,
  recorder,
  logger,
}: {
  repo: Repository
  pullRequest: PullRequest
  baseRepositoryPath: string
  baseIndex: RepositoryCodeIndex
  baseSha: string
  diff: string
  affectedSymbols: string
  semanticCoverage?: string | null
  contextModel: LanguageModel
  contextModelId: string
  classifierModel: LanguageModel
  classifierModelId: string
  contextProviderOptions?: ProviderOptions
  classifierProviderOptions?: ProviderOptions
  recorder: ReviewRunRecorder
  logger: Logger
}): Promise<PreparedRepositoryContext> => {
  await recorder.appendEvent("repository_context.prepare.started", {
    contextModelId,
    classifierModelId,
  })
  const existing = await db.query.repositoryContext.findFirst({
    where: eq(repositoryContext.repositoryId, repo.id),
  })
  await recorder.writeJson("context/repository-context-existing.json", existing)
  const existingMatchesBase = existing?.baseSha === baseSha

  const architectureImpact = existingMatchesBase && existing
    ? await classifyArchitectureImpact({
        existingContext: existing.markdown,
        diff,
        affectedSymbols,
        semanticCoverage,
        model: classifierModel,
        modelId: classifierModelId,
        providerOptions: classifierProviderOptions,
        recorder,
        logger,
        repo,
      })
    : {
        changesArchitecture: true,
        confidence: 1,
        reason: existing
          ? `Existing repository context was generated for ${existing.baseSha}, but the current base is ${baseSha}.`
          : "No persistent repository context exists yet.",
        changedAreas: [
          existing ? "repository_context_base_sha_mismatch" : "missing_repository_context",
        ],
      }

  if (!existingMatchesBase) {
    await recorder.writeJson(
      "context/repository-context-impact.json",
      architectureImpact
    )
  }

  const shouldGenerate = !existing || architectureImpact.changesArchitecture
  await recorder.appendEvent("repository_context.prepare.decision", {
    hasExistingContext: Boolean(existing),
    existingBaseSha: existing?.baseSha,
    currentBaseSha: baseSha,
    existingMatchesBase,
    shouldGenerate,
    architectureImpact,
  })
  logger.info("Repository context preparation decision", {
    repositoryId: repo.id,
    repository: repo.fullName,
    hasExistingContext: Boolean(existing),
    existingBaseSha: existing?.baseSha,
    currentBaseSha: baseSha,
    existingMatchesBase,
    shouldGenerate,
    changesArchitecture: architectureImpact.changesArchitecture,
    reason: architectureImpact.reason,
  })

  if (shouldGenerate) {
    const saved = await generateRepositoryContext({
      repo,
      pullRequest,
      repositoryPath: baseRepositoryPath,
      index: baseIndex,
      analyzedSha: baseSha,
      model: contextModel,
      modelId: contextModelId,
      providerOptions: contextProviderOptions,
      recorder,
      logger,
      reason: existingMatchesBase ? "architecture_impact" : "base_context_missing_or_stale",
    })
    await recorder.appendEvent("repository_context.prepare.completed", {
      source: "generated",
      contextId: saved.id,
      baseSha: saved.baseSha,
    })
    return {
      markdown: saved.markdown,
      summary: saved.summary,
      source: "generated",
      contextId: saved.id,
      baseSha: saved.baseSha,
      architectureImpact,
    }
  }

  await recorder.writeText("context/repository-context.md", existing.markdown)
  await recorder.writeJson("context/repository-context-stats.json", {
    markdownBytes: textBytes(existing.markdown),
    summaryBytes: textBytes(existing.summary),
    modelId: existing.modelId,
    baseSha: existing.baseSha,
    source: "reused",
  })
  await recorder.appendEvent("repository_context.prepare.completed", {
    source: "reused",
    contextId: existing.id,
    baseSha: existing.baseSha,
  })
  return {
    markdown: existing.markdown,
    summary: existing.summary,
    source: "reused",
    contextId: existing.id,
    baseSha: existing.baseSha,
    architectureImpact,
  }
}

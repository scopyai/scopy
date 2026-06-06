import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import Parser from "tree-sitter"
import { adaptersByExtension } from "./adapters"
import { discoverRepositoryFiles } from "./discover"
import { reviewIndexDecision } from "./review-file-policy"
import { resolveGraphs } from "./resolve"
import type {
  CallEdge,
  Diagnostic,
  ExtractedFile,
  FileDependencyEdge,
  ScopeDefinition,
  SymbolDefinition,
} from "./types"

const sourceLikeExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".kt",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".vue",
])

export type RepositoryCodeIndex = {
  repository: string
  repositoryFiles: string[]
  discoveredFiles: number
  ignoredFiles: Array<{ file: string; reason: "hard-ignore" | "soft-ignore" }>
  detectedLanguages: Record<string, number>
  files: ExtractedFile[]
  sourceByFile: Map<string, string>
  scopesById: Map<string, ScopeDefinition>
  symbolsById: Map<string, SymbolDefinition>
  graph: {
    dependencies: FileDependencyEdge[]
    symbols: SymbolDefinition[]
    edges: CallEdge[]
    unresolvedCalls: Awaited<ReturnType<typeof resolveGraphs>>["unresolvedCalls"]
    diagnostics: Diagnostic[]
  }
  diagnostics: Diagnostic[]
}

const compareDiagnostics = (a: Diagnostic, b: Diagnostic) => {
  if (!a.file && !b.file) return a.message.localeCompare(b.message)
  if (!a.file) return -1
  if (!b.file) return 1
  return (
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    a.message.localeCompare(b.message)
  )
}

export const buildRepositoryCodeIndex = async ({
  repository: inputRepository,
  changedFiles = [],
}: {
  repository: string
  changedFiles?: string[]
}): Promise<RepositoryCodeIndex> => {
  const repository = await realpath(inputRepository)
  const discoveredRepositoryFiles = await discoverRepositoryFiles(repository)
  const changedFileSet = new Set(changedFiles)
  const ignoredFiles: RepositoryCodeIndex["ignoredFiles"] = []
  const repositoryFiles = discoveredRepositoryFiles.filter((file) => {
    const decision = reviewIndexDecision(file, changedFileSet)
    if (!decision.index && decision.reason) {
      ignoredFiles.push({ file, reason: decision.reason })
    }
    return decision.index
  })
  const diagnostics: Diagnostic[] = []
  const detectedLanguages: Record<string, number> = {}
  const sourceByFile = new Map<string, string>()
  const extractedFiles: ExtractedFile[] = []

  for (const file of repositoryFiles) {
    const extension = path.extname(file)
    const adapter = adaptersByExtension.get(extension)
    if (!adapter) {
      if (sourceLikeExtensions.has(extension)) {
        diagnostics.push({
          kind: "unsupported-language",
          file,
          message: `No language adapter is registered for '${extension}' files`,
        })
      }
      continue
    }

    detectedLanguages[adapter.id] = (detectedLanguages[adapter.id] ?? 0) + 1
    const source = await readFile(path.join(repository, file), "utf8")
    sourceByFile.set(file, source)
    const parser = new Parser()
    parser.setLanguage(adapter.language)
    const extracted = adapter.extract(file, source, parser.parse(source))
    extractedFiles.push(extracted)
    diagnostics.push(...extracted.diagnostics)
  }

  const graph = await resolveGraphs({
    repository,
    files: extractedFiles,
    repositoryFiles,
  })
  diagnostics.push(...graph.diagnostics)

  return {
    repository,
    repositoryFiles,
    discoveredFiles: discoveredRepositoryFiles.length,
    ignoredFiles,
    detectedLanguages: Object.fromEntries(
      Object.entries(detectedLanguages).sort(([a], [b]) => a.localeCompare(b)),
    ),
    files: extractedFiles,
    sourceByFile,
    scopesById: new Map(
      extractedFiles.flatMap((file) => file.scopes.map((scope) => [scope.id, scope])),
    ),
    symbolsById: new Map(graph.symbols.map((symbol) => [symbol.id, symbol])),
    graph: {
      dependencies: graph.dependencies,
      symbols: graph.symbols,
      edges: graph.edges,
      unresolvedCalls: graph.unresolvedCalls,
      diagnostics: graph.diagnostics,
    },
    diagnostics: diagnostics.sort(compareDiagnostics),
  }
}

export const lineSlice = (source: string, startLine: number, endLine: number) =>
  source.split(/\r?\n/).slice(startLine - 1, endLine).join("\n")

export const lineAt = (source: string, line: number) =>
  source.split(/\r?\n/)[line - 1] ?? ""

export const scopeForSymbol = (
  index: RepositoryCodeIndex,
  symbol: SymbolDefinition,
) => {
  const scopes = index.files.find((file) => file.path === symbol.file)?.scopes ?? []
  return scopes
    .filter(
      (scope) =>
        scope.name === symbol.name &&
        scope.kind === symbol.kind &&
        scope.startLine <= symbol.line &&
        scope.endLine >= symbol.line,
    )
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0]
}

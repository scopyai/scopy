import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import Parser from "tree-sitter"
import { adaptersByExtension } from "./adapters"
import { discoverRepositoryFiles } from "./discover"
import { resolveGraphs } from "./resolve"
import type {
  AnalysisResult,
  CallEdge,
  CallerChain,
  DefinitionImpact,
  Diagnostic,
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

const compareLocations = <T extends { file: string; line: number; column: number }>(
  a: T,
  b: T,
) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column

const reverseCallerChains = (
  definition: SymbolDefinition,
  edges: CallEdge[],
): CallerChain[] => {
  const edgesByCallee = new Map<string, CallEdge[]>()
  for (const edge of edges) {
    edgesByCallee.set(edge.calleeSymbolId, [
      ...(edgesByCallee.get(edge.calleeSymbolId) ?? []),
      edge,
    ])
  }
  const chains: CallerChain[] = []
  const visit = (symbolId: string, symbols: string[], calls: string[]) => {
    for (const edge of edgesByCallee.get(symbolId) ?? []) {
      if (!edge.callerSymbolId || symbols.includes(edge.callerSymbolId)) continue
      const nextSymbols = [...symbols, edge.callerSymbolId]
      const nextCalls = [...calls, edge.id]
      chains.push({ symbols: nextSymbols, calls: nextCalls })
      visit(edge.callerSymbolId, nextSymbols, nextCalls)
    }
  }
  visit(definition.id, [], [])
  return chains.sort((a, b) => a.symbols.join().localeCompare(b.symbols.join()))
}

const impactFor = (
  definition: SymbolDefinition,
  edges: CallEdge[],
  directOnly: boolean,
): DefinitionImpact => ({
  definitionId: definition.id,
  directCallers: edges
    .filter((edge) => edge.calleeSymbolId === definition.id)
    .sort((a, b) => compareLocations(a.callSite, b.callSite)),
  transitiveCallerChains: directOnly ? [] : reverseCallerChains(definition, edges),
})

export const analyzeRepository = async ({
  repository: inputRepository,
  functionName,
  includeGraph = false,
  directOnly = false,
}: {
  repository: string
  functionName: string
  includeGraph?: boolean
  directOnly?: boolean
}): Promise<AnalysisResult> => {
  const repository = await realpath(inputRepository)
  const repositoryFiles = await discoverRepositoryFiles(repository)
  const diagnostics: Diagnostic[] = []
  const detectedLanguages: Record<string, number> = {}
  const extractedFiles = []

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
    const parser = new Parser()
    parser.setLanguage(adapter.language)
    extractedFiles.push(adapter.extract(file, source, parser.parse(source)))
  }

  for (const file of extractedFiles) diagnostics.push(...file.diagnostics)
  const graph = await resolveGraphs({ repository, files: extractedFiles, repositoryFiles })
  diagnostics.push(...graph.diagnostics)
  const definitions = graph.symbols
    .filter((symbol) => symbol.name === functionName)
    .sort(compareLocations)
  const unresolvedCandidates = graph.unresolvedCalls
    .filter((call) => call.name === functionName)
    .sort(compareLocations)
  const result: AnalysisResult = {
    repository,
    detectedLanguages: Object.fromEntries(
      Object.entries(detectedLanguages).sort(([a], [b]) => a.localeCompare(b)),
    ),
    query: { functionName },
    definitions,
    impacts: definitions.map((definition) =>
      impactFor(definition, graph.edges, directOnly),
    ),
    unresolvedCandidates,
    diagnostics: diagnostics.sort((a, b) => {
      if (!a.file && !b.file) return a.message.localeCompare(b.message)
      if (!a.file) return -1
      if (!b.file) return 1
      return compareLocations(
        { file: a.file, line: a.line ?? 0, column: a.column ?? 0 },
        { file: b.file, line: b.line ?? 0, column: b.column ?? 0 },
      )
    }),
  }

  if (includeGraph) {
    result.graph = {
      files: extractedFiles
        .map(({ path: file, language }) => ({ path: file, language }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      dependencies: graph.dependencies.sort(
        (a, b) => a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier),
      ),
      symbols: graph.symbols.sort(compareLocations),
      calls: graph.edges.sort((a, b) => compareLocations(a.callSite, b.callSite)),
    }
  }

  return result
}

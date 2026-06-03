import { buildRepositoryCodeIndex } from "./code-index"
import type {
  AnalysisResult,
  CallEdge,
  CallerChain,
  DefinitionImpact,
  SymbolDefinition,
} from "./types"

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
  const index = await buildRepositoryCodeIndex({ repository: inputRepository })
  const { repository, detectedLanguages, graph } = index
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
    diagnostics: index.diagnostics,
  }

  if (includeGraph) {
    result.graph = {
      files: index.files
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

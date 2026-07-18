import type { RepositoryCodeIndex } from "./code-index"
import {
  inspectSymbol,
  inspectSymbolInIndex,
  type InspectedCallSite,
  type InspectedDefinition,
  type InspectSymbolResult,
} from "./symbol-inspect"

export type GetSymbolDefinitionInput = {
  repository: string
  symbol: string
  ref?: string
  keepTemporaryRepository?: boolean
  index?: RepositoryCodeIndex
}

export type GetSymbolCallersInput = GetSymbolDefinitionInput

export type CompactSymbolDefinition = InspectedDefinition

export type CompactCallSite = InspectedCallSite

export type SymbolDefinitionContext = {
  repositoryPath: string
  detectedLanguages: Record<string, number>
  query: InspectSymbolResult["query"]
  definitions: CompactSymbolDefinition[]
  diagnostics: InspectSymbolResult["diagnostics"]
}

export type SymbolCallersContext = SymbolDefinitionContext & {
  callers: Array<{
    definitionId: string
    directCallers: CompactCallSite[]
  }>
  unresolvedCandidates: CompactCallSite[]
}

export type GetSymbolDefinitionOutput = {
  repositoryPath: string
  json: SymbolDefinitionContext
  stats: {
    definitions: number
    diagnostics: number
    sourceIncluded: boolean
    parentSourceIncluded: boolean
    bytes: number
  }
}

export type GetSymbolCallersOutput = {
  repositoryPath: string
  json: SymbolCallersContext
  stats: {
    definitions: number
    directCallers: number
    unresolvedCandidates: number
    diagnostics: number
    sourceIncluded: boolean
    truncated: boolean
    bytes: number
  }
}

const inspect = async ({
  repository,
  symbol,
  ref,
  includeSource = false,
  includeParentSource = false,
  includeCallers = false,
  includeCallerDefinitions = false,
  includeUnresolved = true,
  keepTemporaryRepository = false,
  index,
}: GetSymbolDefinitionInput & {
  includeSource?: boolean
  includeParentSource?: boolean
  includeCallers?: boolean
  includeCallerDefinitions?: boolean
  includeUnresolved?: boolean
}) =>
  index
    ? inspectSymbolInIndex({
        index,
        symbol,
        includeCallers,
        includeDefinitionSource: includeSource,
        includeParentSource,
        includeCallerDefinitions,
        includeUnresolved,
      })
    : inspectSymbol({
        repository,
        symbol,
        ref,
        includeCallers,
        includeDefinitionSource: includeSource,
        includeParentSource,
        includeCallerDefinitions,
        includeUnresolved,
        keepTemporaryRepository,
      })

const byteLength = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8")

export const getSymbolDefinition = async ({
  repository,
  symbol,
  ref,
  keepTemporaryRepository = false,
  index,
}: GetSymbolDefinitionInput): Promise<GetSymbolDefinitionOutput> => {
  const result = await inspect({
    repository,
    symbol,
    ref,
    includeSource: true,
    includeUnresolved: false,
    keepTemporaryRepository,
    index,
  })
  const json: SymbolDefinitionContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions: result.definitions,
    diagnostics: result.diagnostics,
  }

  return {
    repositoryPath: result.repositoryPath,
    json,
    stats: {
      definitions: json.definitions.length,
      diagnostics: json.diagnostics.length,
      sourceIncluded: true,
      parentSourceIncluded: false,
      bytes: byteLength(json),
    },
  }
}

const MAX_REVIEW_CALLERS = 50

export const getSymbolCallers = async ({
  repository,
  symbol,
  ref,
  keepTemporaryRepository = false,
  index,
}: GetSymbolCallersInput): Promise<GetSymbolCallersOutput> => {
  const result = await inspect({
    repository,
    symbol,
    ref,
    includeSource: false,
    includeParentSource: false,
    includeCallers: true,
    includeCallerDefinitions: false,
    includeUnresolved: true,
    keepTemporaryRepository,
    index,
  })
  let truncated = false
  let remaining = MAX_REVIEW_CALLERS
  const callers = (result.callers ?? []).map((group) => {
    const directCallers = group.directCallers.slice(0, remaining)
    if (directCallers.length < group.directCallers.length) truncated = true
    remaining = Math.max(0, remaining - directCallers.length)
    return {
      definitionId: group.definitionId,
      directCallers,
    }
  })
  const unresolvedCandidates =
    remaining > 0 ? (result.unresolvedCandidates ?? []).slice(0, remaining) : []
  if (
    unresolvedCandidates.length < (result.unresolvedCandidates ?? []).length
  ) {
    truncated = true
  }
  const json: SymbolCallersContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions: result.definitions,
    callers,
    unresolvedCandidates,
    diagnostics: result.diagnostics,
  }

  return {
    repositoryPath: result.repositoryPath,
    json,
    stats: {
      definitions: json.definitions.length,
      directCallers: json.callers.reduce(
        (total, group) => total + group.directCallers.length,
        0
      ),
      unresolvedCandidates: json.unresolvedCandidates.length,
      diagnostics: json.diagnostics.length,
      sourceIncluded: false,
      truncated,
      bytes: byteLength(json),
    },
  }
}

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
  offset?: number
  limit?: number
  maxSourceBytes?: number
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
    totalDefinitions: number
    diagnostics: number
    sourceIncluded: boolean
    parentSourceIncluded: boolean
    offset: number
    limit: number
    hasMore: boolean
    bytes: number
  }
}

export type GetSymbolCallersOutput = {
  repositoryPath: string
  json: SymbolCallersContext
  stats: {
    definitions: number
    totalCallers: number
    directCallers: number
    unresolvedCandidates: number
    diagnostics: number
    sourceIncluded: boolean
    truncated: boolean
    offset: number
    limit: number
    hasMore: boolean
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

const DEFAULT_DEFINITION_LIMIT = 3
const MAX_DEFINITION_LIMIT = 20
const DEFAULT_CALLER_LIMIT = 8
const MAX_CALLER_LIMIT = 50
const MAX_REVIEW_CALLERS = 200
const DEFAULT_SOURCE_BYTES = 8_000
const MAX_SOURCE_BYTES = 40_000

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) => Math.min(maximum, Math.max(minimum, Math.floor(value ?? fallback)))

const truncateSource = (source: string | undefined, maxBytes: number) => {
  if (!source || Buffer.byteLength(source, "utf8") <= maxBytes) return source
  let output = source
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, Math.floor(output.length * 0.9))
  }
  return `${output}\n\n[truncated; request a larger maxSourceBytes or use read_file]`
}

export const getSymbolDefinition = async ({
  repository,
  symbol,
  ref,
  keepTemporaryRepository = false,
  index,
  offset,
  limit,
  maxSourceBytes,
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
  const safeOffset = boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const safeLimit = boundedInteger(
    limit,
    DEFAULT_DEFINITION_LIMIT,
    1,
    MAX_DEFINITION_LIMIT
  )
  const safeSourceBytes = boundedInteger(
    maxSourceBytes,
    DEFAULT_SOURCE_BYTES,
    1_000,
    MAX_SOURCE_BYTES
  )
  const definitions = result.definitions
    .slice(safeOffset, safeOffset + safeLimit)
    .map((definition) => ({
      ...definition,
      source: truncateSource(definition.source, safeSourceBytes),
    }))
  const json: SymbolDefinitionContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions,
    diagnostics: result.diagnostics.slice(0, 20),
  }

  return {
    repositoryPath: result.repositoryPath,
    json,
    stats: {
      definitions: json.definitions.length,
      totalDefinitions: result.definitions.length,
      diagnostics: json.diagnostics.length,
      sourceIncluded: true,
      parentSourceIncluded: false,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + definitions.length < result.definitions.length,
      bytes: byteLength(json),
    },
  }
}

export const getSymbolCallers = async ({
  repository,
  symbol,
  ref,
  keepTemporaryRepository = false,
  index,
  offset,
  limit,
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
  const safeOffset = boundedInteger(offset, 0, 0, MAX_REVIEW_CALLERS - 1)
  const safeLimit = boundedInteger(
    limit,
    DEFAULT_CALLER_LIMIT,
    1,
    MAX_CALLER_LIMIT
  )
  const directItems = (result.callers ?? []).flatMap((group) =>
    group.directCallers.map((caller) => ({
      definitionId: group.definitionId,
      caller,
    }))
  )
  const unresolvedItems = result.unresolvedCandidates ?? []
  const totalCallers = directItems.length + unresolvedItems.length
  const cappedDirectItems = directItems.slice(0, MAX_REVIEW_CALLERS)
  const remainingCapacity = Math.max(
    0,
    MAX_REVIEW_CALLERS - cappedDirectItems.length
  )
  const available = [
    ...cappedDirectItems.map((item) => ({ type: "direct" as const, ...item })),
    ...unresolvedItems
      .slice(0, remainingCapacity)
      .map((caller) => ({ type: "unresolved" as const, caller })),
  ]
  const page = available.slice(safeOffset, safeOffset + safeLimit)
  const callersByDefinition = new Map<string, CompactCallSite[]>()
  for (const item of page) {
    if (item.type !== "direct") continue
    callersByDefinition.set(item.definitionId, [
      ...(callersByDefinition.get(item.definitionId) ?? []),
      item.caller,
    ])
  }
  const callers = [...callersByDefinition].map(
    ([definitionId, directCallers]) => ({ definitionId, directCallers })
  )
  const unresolvedCandidates = page
    .filter((item) => item.type === "unresolved")
    .map((item) => item.caller)
  const hasMore = safeOffset + page.length < available.length
  const truncated = totalCallers > available.length
  const json: SymbolCallersContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions: result.definitions.slice(0, 20),
    callers,
    unresolvedCandidates,
    diagnostics: result.diagnostics.slice(0, 20),
  }

  return {
    repositoryPath: result.repositoryPath,
    json,
    stats: {
      definitions: json.definitions.length,
      totalCallers,
      directCallers: json.callers.reduce(
        (total, group) => total + group.directCallers.length,
        0
      ),
      unresolvedCandidates: json.unresolvedCandidates.length,
      diagnostics: json.diagnostics.length,
      sourceIncluded: false,
      truncated,
      offset: safeOffset,
      limit: safeLimit,
      hasMore,
      bytes: byteLength(json),
    },
  }
}

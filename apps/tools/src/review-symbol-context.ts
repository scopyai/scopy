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
  includeSource?: boolean
  includeParentSource?: boolean
  keepTemporaryRepository?: boolean
  index?: RepositoryCodeIndex
}

export type GetSymbolCallersInput = GetSymbolDefinitionInput & {
  includeCallerDefinitions?: boolean
  includeUnresolved?: boolean
  maxCallers?: number
}

export type CompactSymbolDefinition = Omit<
  InspectedDefinition,
  "source" | "parentScope"
> & {
  source?: string
  parentScope?: Omit<NonNullable<InspectedDefinition["parentScope"]>, "source"> & {
    source?: string
  }
}

export type CompactCallSite = Omit<
  InspectedCallSite,
  "enclosingSymbol"
> & {
  enclosingSymbol?: Omit<
    NonNullable<InspectedCallSite["enclosingSymbol"]>,
    "source"
  > & {
    source?: string
  }
}

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

const compactDefinition = (
  definition: InspectedDefinition,
): CompactSymbolDefinition => {
  const { source, parentScope, ...rest } = definition
  return {
    ...rest,
    ...(source ? { source } : {}),
    ...(parentScope
      ? {
          parentScope: {
            id: parentScope.id,
            name: parentScope.name,
            kind: parentScope.kind,
            file: parentScope.file,
            line: parentScope.line,
            column: parentScope.column,
            startLine: parentScope.startLine,
            endLine: parentScope.endLine,
            ...(parentScope.source ? { source: parentScope.source } : {}),
          },
        }
      : {}),
  }
}

const compactCallSite = (call: InspectedCallSite): CompactCallSite => {
  const { enclosingSymbol, ...rest } = call
  return {
    ...rest,
    ...(enclosingSymbol
      ? {
          enclosingSymbol: {
            id: enclosingSymbol.id,
            name: enclosingSymbol.name,
            kind: enclosingSymbol.kind,
            file: enclosingSymbol.file,
            line: enclosingSymbol.line,
            column: enclosingSymbol.column,
            startLine: enclosingSymbol.startLine,
            endLine: enclosingSymbol.endLine,
            ...(enclosingSymbol.source
              ? { source: enclosingSymbol.source }
              : {}),
          },
        }
      : {}),
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
  includeSource = false,
  includeParentSource = false,
  keepTemporaryRepository = false,
  index,
}: GetSymbolDefinitionInput): Promise<GetSymbolDefinitionOutput> => {
  const result = await inspect({
    repository,
    symbol,
    ref,
    includeSource,
    includeParentSource,
    includeUnresolved: false,
    keepTemporaryRepository,
    index,
  })
  const json: SymbolDefinitionContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions: result.definitions.map(compactDefinition),
    diagnostics: result.diagnostics,
  }

  return {
    repositoryPath: result.repositoryPath,
    json,
    stats: {
      definitions: json.definitions.length,
      diagnostics: json.diagnostics.length,
      sourceIncluded: includeSource,
      parentSourceIncluded: includeParentSource,
      bytes: byteLength(json),
    },
  }
}

export const getSymbolCallers = async ({
  repository,
  symbol,
  ref,
  includeSource = false,
  includeParentSource = false,
  includeCallerDefinitions = false,
  includeUnresolved = true,
  maxCallers = 50,
  keepTemporaryRepository = false,
  index,
}: GetSymbolCallersInput): Promise<GetSymbolCallersOutput> => {
  const result = await inspect({
    repository,
    symbol,
    ref,
    includeSource,
    includeParentSource,
    includeCallers: true,
    includeCallerDefinitions,
    includeUnresolved,
    keepTemporaryRepository,
    index,
  })
  const callerLimit = Math.max(1, Math.floor(maxCallers))
  let truncated = false
  let remaining = callerLimit
  const callers = (result.callers ?? []).map((group) => {
    const directCallers = group.directCallers.slice(0, remaining)
    if (directCallers.length < group.directCallers.length) truncated = true
    remaining = Math.max(0, remaining - directCallers.length)
    return {
      definitionId: group.definitionId,
      directCallers: directCallers.map(compactCallSite),
    }
  })
  const unresolvedCandidates = includeUnresolved && remaining > 0
    ? (result.unresolvedCandidates ?? []).slice(0, remaining).map(compactCallSite)
    : []
  if (
    includeUnresolved &&
    unresolvedCandidates.length < (result.unresolvedCandidates ?? []).length
  ) {
    truncated = true
  }
  const json: SymbolCallersContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions: result.definitions.map(compactDefinition),
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
        0,
      ),
      unresolvedCandidates: json.unresolvedCandidates.length,
      diagnostics: json.diagnostics.length,
      sourceIncluded:
        includeSource || includeParentSource || includeCallerDefinitions,
      truncated,
      bytes: byteLength(json),
    },
  }
}

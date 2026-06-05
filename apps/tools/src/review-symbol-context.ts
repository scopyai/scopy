import type { RepositoryCodeIndex } from "./code-index"
import {
  inspectSymbol,
  inspectSymbolInIndex,
  type InspectSymbolResult,
} from "./symbol-inspect"
import { renderReadableSymbolInspection } from "./symbol-readable"

export type GetSymbolDefinitionInput = {
  repository: string
  symbol: string
  ref?: string
  keepTemporaryRepository?: boolean
  index?: RepositoryCodeIndex
}

export type GetSymbolCallersInput =
  GetSymbolDefinitionInput & {
    includeCallerDefinitions?: boolean
    includeUnresolved?: boolean
  }

export type SymbolDefinitionContext = Omit<
  InspectSymbolResult,
  "callers" | "unresolvedCandidates"
>

export type SymbolCallersContext = InspectSymbolResult & {
  callers: NonNullable<InspectSymbolResult["callers"]>
  unresolvedCandidates: NonNullable<InspectSymbolResult["unresolvedCandidates"]>
}

export type GetSymbolDefinitionOutput = {
  repositoryPath: string
  json: SymbolDefinitionContext
  markdown: string
  stats: {
    definitions: number
    diagnostics: number
    bytes: number
  }
}

export type GetSymbolCallersOutput = {
  repositoryPath: string
  json: SymbolCallersContext
  markdown: string
  stats: {
    definitions: number
    directCallers: number
    unresolvedCandidates: number
    diagnostics: number
    bytes: number
  }
}

export const getSymbolDefinition = async ({
  repository,
  symbol,
  ref,
  keepTemporaryRepository = false,
  index,
}: GetSymbolDefinitionInput): Promise<GetSymbolDefinitionOutput> => {
  const result = index
    ? inspectSymbolInIndex({
        index,
        symbol,
        includeCallers: false,
        includeUnresolved: false,
      })
    : await inspectSymbol({
        repository,
        symbol,
        ref,
        includeCallers: false,
        includeUnresolved: false,
        keepTemporaryRepository,
      })
  const json: SymbolDefinitionContext = {
    repositoryPath: result.repositoryPath,
    detectedLanguages: result.detectedLanguages,
    query: result.query,
    definitions: result.definitions,
    diagnostics: result.diagnostics,
  }
  const markdown = renderReadableSymbolInspection(json)

  return {
    repositoryPath: result.repositoryPath,
    json,
    markdown,
    stats: {
      definitions: json.definitions.length,
      diagnostics: json.diagnostics.length,
      bytes: Buffer.byteLength(markdown, "utf8"),
    },
  }
}

export const getSymbolCallers = async ({
  repository,
  symbol,
  ref,
  includeCallerDefinitions = false,
  includeUnresolved = true,
  keepTemporaryRepository = false,
  index,
}: GetSymbolCallersInput): Promise<GetSymbolCallersOutput> => {
  const result = index
    ? inspectSymbolInIndex({
        index,
        symbol,
        includeCallers: true,
        includeCallerDefinitions,
        includeUnresolved,
      })
    : await inspectSymbol({
        repository,
        symbol,
        ref,
        includeCallers: true,
        includeCallerDefinitions,
        includeUnresolved,
        keepTemporaryRepository,
      })
  const json: SymbolCallersContext = {
    ...result,
    callers: result.callers ?? [],
    unresolvedCandidates: result.unresolvedCandidates ?? [],
  }
  const markdown = renderReadableSymbolInspection(json)

  return {
    repositoryPath: result.repositoryPath,
    json,
    markdown,
    stats: {
      definitions: json.definitions.length,
      directCallers: json.callers.reduce(
        (total, group) => total + group.directCallers.length,
        0,
      ),
      unresolvedCandidates: json.unresolvedCandidates.length,
      diagnostics: json.diagnostics.length,
      bytes: Buffer.byteLength(markdown, "utf8"),
    },
  }
}

import {
  buildRepositoryCodeIndex,
  lineAt,
  lineSlice,
  scopeForSymbol,
  type RepositoryCodeIndex,
} from "./code-index"
import { prepareRepository } from "./repository"
import type {
  CallKind,
  Confidence,
  Diagnostic,
  ScopeKind,
  SourceLocation,
  SymbolDefinition,
  SymbolKind,
} from "./types"

export type InspectSymbolInput = {
  repository: string
  symbol: string
  ref?: string
  includeCallers?: boolean
  includeCallerDefinitions?: boolean
  includeUnresolved?: boolean
  keepTemporaryRepository?: boolean
}

export type InspectedScope = SourceLocation & {
  id: string
  name: string
  kind: ScopeKind
  startLine: number
  endLine: number
  source?: string
}

export type InspectedDefinition = SymbolDefinition & {
  startLine?: number
  endLine?: number
  source?: string
  parentScope?: InspectedScope
}

export type InspectedCallSite = SourceLocation & {
  id: string
  name: string
  callee: string
  kind: CallKind
  receiver?: string
  confidence: Confidence
  callLine: string
  enclosingSymbol?: {
    id: string
    name: string
    kind: SymbolKind
    file: string
    line: number
    column: number
    startLine?: number
    endLine?: number
    source?: string
  }
}

export type DefinitionCallers = {
  definitionId: string
  directCallers: InspectedCallSite[]
}

export type InspectSymbolResult = {
  repositoryPath: string
  detectedLanguages: Record<string, number>
  query: { symbol: string }
  definitions: InspectedDefinition[]
  callers?: DefinitionCallers[]
  unresolvedCandidates?: InspectedCallSite[]
  diagnostics: Diagnostic[]
}

const compareLocations = <T extends { file: string; line: number; column: number }>(
  a: T,
  b: T,
) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column

const sourceFor = (
  index: RepositoryCodeIndex,
  file: string,
  startLine: number,
  endLine: number,
) => {
  const source = index.sourceByFile.get(file)
  return source ? lineSlice(source, startLine, endLine) : undefined
}

const parentClassScopeFor = (
  index: RepositoryCodeIndex,
  scopeId: string | undefined,
): InspectedScope | undefined => {
  let current = scopeId ? index.scopesById.get(scopeId) : undefined
  while (current?.parentScopeId) {
    const parent = index.scopesById.get(current.parentScopeId)
    if (!parent) break
    if (parent.kind === "class") {
      return {
        id: parent.id,
        name: parent.name,
        kind: parent.kind,
        file: parent.file,
        line: parent.line,
        column: parent.column,
        startLine: parent.startLine,
        endLine: parent.endLine,
        source: sourceFor(index, parent.file, parent.startLine, parent.endLine),
      }
    }
    current = parent
  }
  return undefined
}

const inspectDefinition = (
  index: RepositoryCodeIndex,
  definition: SymbolDefinition,
): InspectedDefinition => {
  const scope = scopeForSymbol(index, definition)
  return {
    ...definition,
    startLine: scope?.startLine,
    endLine: scope?.endLine,
    source: scope
      ? sourceFor(index, definition.file, scope.startLine, scope.endLine)
      : undefined,
    parentScope: parentClassScopeFor(index, scope?.id),
  }
}

const inspectCallSite = (
  index: RepositoryCodeIndex,
  call: {
    id: string
    file: string
    line: number
    column: number
    name: string
    callee: string
    kind: CallKind
    receiver?: string
    confidence: Confidence
    enclosingSymbolId?: string
  },
  includeCallerDefinitions: boolean,
): InspectedCallSite => {
  const source = index.sourceByFile.get(call.file)
  const enclosing = call.enclosingSymbolId
    ? index.symbolsById.get(call.enclosingSymbolId)
    : undefined
  const enclosingScope = enclosing ? scopeForSymbol(index, enclosing) : undefined

  return {
    id: call.id,
    file: call.file,
    line: call.line,
    column: call.column,
    name: call.name,
    callee: call.callee,
    kind: call.kind,
    receiver: call.receiver,
    confidence: call.confidence,
    callLine: source ? lineAt(source, call.line) : "",
    enclosingSymbol: enclosing
      ? {
          id: enclosing.id,
          name: enclosing.name,
          kind: enclosing.kind,
          file: enclosing.file,
          line: enclosing.line,
          column: enclosing.column,
          startLine: enclosingScope?.startLine,
          endLine: enclosingScope?.endLine,
          source:
            includeCallerDefinitions && enclosingScope
              ? sourceFor(
                  index,
                  enclosing.file,
                  enclosingScope.startLine,
                  enclosingScope.endLine,
                )
              : undefined,
        }
      : undefined,
  }
}

const buildSymbolInspection = async ({
  repository,
  symbol,
  includeCallers = false,
  includeCallerDefinitions = false,
  includeUnresolved = true,
}: Omit<
  InspectSymbolInput,
  "ref" | "keepTemporaryRepository"
>): Promise<InspectSymbolResult> => {
  const index = await buildRepositoryCodeIndex({ repository })
  const diagnostics = index.diagnostics.filter(
    (diagnostic) =>
      diagnostic.kind !== "ambiguous-call" ||
      diagnostic.message.includes(`'${symbol}'`) ||
      diagnostic.message.includes(`"${symbol}"`),
  )
  const definitions = index.graph.symbols
    .filter((definition) => definition.name === symbol)
    .sort(compareLocations)
    .map((definition) => inspectDefinition(index, definition))

  const result: InspectSymbolResult = {
    repositoryPath: index.repository,
    detectedLanguages: index.detectedLanguages,
    query: { symbol },
    definitions,
    diagnostics,
  }

  if (includeCallers) {
    result.callers = definitions.map((definition) => ({
      definitionId: definition.id,
      directCallers: index.graph.edges
        .filter((edge) => edge.calleeSymbolId === definition.id)
        .map((edge) =>
          inspectCallSite(index, edge.callSite, includeCallerDefinitions),
        )
        .sort(compareLocations),
    }))
  }

  if (includeUnresolved) {
    result.unresolvedCandidates = index.graph.unresolvedCalls
      .filter((call) => call.name === symbol)
      .map((call) => inspectCallSite(index, call, includeCallerDefinitions))
      .sort(compareLocations)
  }

  return result
}

export const inspectSymbol = async ({
  repository,
  symbol,
  ref,
  includeCallers,
  includeCallerDefinitions,
  includeUnresolved,
  keepTemporaryRepository = false,
}: InspectSymbolInput): Promise<InspectSymbolResult> => {
  const prepared = await prepareRepository({ repository, ref })
  try {
    return await buildSymbolInspection({
      repository: prepared.path,
      symbol,
      includeCallers,
      includeCallerDefinitions,
      includeUnresolved,
    })
  } finally {
    if (!keepTemporaryRepository) await prepared.cleanup()
  }
}

export type SymbolKind = "function" | "method" | "object-method"
export type CallKind = "identifier" | "member" | "this-method" | "namespace"
export type Confidence = "resolved" | "ambiguous" | "unresolved"

export type SourceLocation = {
  file: string
  line: number
  column: number
}

export type SymbolDefinition = SourceLocation & {
  id: string
  name: string
  kind: SymbolKind
  enclosingSymbolId?: string
  containerName?: string
  exported: boolean
  defaultExport: boolean
}

export type CallSite = SourceLocation & {
  id: string
  name: string
  callee: string
  kind: CallKind
  receiver?: string
  enclosingSymbolId?: string
  confidence: Confidence
}

export type CallEdge = {
  id: string
  callerSymbolId?: string
  calleeSymbolId: string
  callSite: CallSite
  confidence: "resolved"
}

export type FileNode = {
  path: string
  language: string
}

export type FileDependencyEdge = {
  from: string
  specifier: string
  to?: string
  toScope?: string
  kind: "import" | "export"
  resolved: boolean
}

export type CallerChain = {
  symbols: string[]
  calls: string[]
}

export type DefinitionImpact = {
  definitionId: string
  directCallers: CallEdge[]
  transitiveCallerChains: CallerChain[]
}

export type Diagnostic = {
  kind:
    | "unsupported-language"
    | "parse-error"
    | "unresolved-import"
    | "ambiguous-call"
    | "unresolved-call"
  message: string
  file?: string
  line?: number
  column?: number
}

export type AnalysisResult = {
  repository: string
  detectedLanguages: Record<string, number>
  query: { functionName: string }
  definitions: SymbolDefinition[]
  impacts: DefinitionImpact[]
  unresolvedCandidates: CallSite[]
  diagnostics: Diagnostic[]
  graph?: {
    files: FileNode[]
    dependencies: FileDependencyEdge[]
    symbols: SymbolDefinition[]
    calls: CallEdge[]
  }
}

export type ImportBinding = {
  local: string
  imported: string
  kind: "default" | "named" | "namespace"
}

export type ImportRecord = {
  source: string
  resolution?: "python-module" | "go-package" | "java-class" | "rust-module"
  kind: "import" | "export"
  bindings: ImportBinding[]
  line: number
  column: number
}

export type ExtractedFile = FileNode & {
  localScope?: string
  symbols: SymbolDefinition[]
  calls: CallSite[]
  imports: ImportRecord[]
  diagnostics: Diagnostic[]
}

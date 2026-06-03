import type Parser from "tree-sitter"
import type {
  CallSite,
  Diagnostic,
  ExtractedFile,
  ImportRecord,
  ScopeDefinition,
  SymbolDefinition,
} from "../types"
import type { LanguageAdapter } from "./types"

export type SyntaxNode = Parser.SyntaxNode

export const text = (node: SyntaxNode | null | undefined) => node?.text ?? ""

export const walk = (node: SyntaxNode, visit: (node: SyntaxNode) => void) => {
  visit(node)
  for (const child of node.namedChildren) walk(child, visit)
}

export const ancestor = (
  node: SyntaxNode | null,
  predicate: (candidate: SyntaxNode) => boolean,
) => {
  let current = node
  while (current) {
    if (predicate(current)) return current
    current = current.parent
  }
  return undefined
}

const contains = (outer: SyntaxNode, inner: SyntaxNode) =>
  outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex

export const symbol = ({
  file,
  node,
  name,
  kind = "function",
  containerName,
  exported = true,
}: {
  file: string
  node: SyntaxNode
  name: string
  kind?: SymbolDefinition["kind"]
  containerName?: string
  exported?: boolean
}): SymbolDefinition => ({
  id: `${file}:${node.startPosition.row + 1}:${node.startPosition.column + 1}:${name}`,
  file,
  line: node.startPosition.row + 1,
  column: node.startPosition.column + 1,
  name,
  kind,
  containerName,
  exported,
  defaultExport: false,
})

export const scope = ({
  file,
  node,
  name,
  kind,
}: {
  file: string
  node: SyntaxNode
  name: string
  kind: ScopeDefinition["kind"]
}): ScopeDefinition => ({
  id: `${file}:${node.startPosition.row + 1}:${node.startPosition.column + 1}:${name}:${kind}`,
  file,
  line: node.startPosition.row + 1,
  column: node.startPosition.column + 1,
  name,
  kind,
  startLine: node.startPosition.row + 1,
  endLine: node.endPosition.row + 1,
  startIndex: node.startIndex,
  endIndex: node.endIndex,
})

export const call = ({
  file,
  node,
  name,
  callee,
  kind = "identifier",
  receiver,
}: {
  file: string
  node: SyntaxNode
  name: string
  callee: string
  kind?: CallSite["kind"]
  receiver?: string
}): CallSite => ({
  id: `${file}:${node.startPosition.row + 1}:${node.startPosition.column + 1}:${callee}`,
  file,
  line: node.startPosition.row + 1,
  column: node.startPosition.column + 1,
  name,
  callee,
  kind,
  receiver,
  confidence: "unresolved",
})

export const createAdapter = ({
  id,
  extensions,
  language,
  symbolFromNode,
  scopeFromNode,
  callFromNode,
  importFromNode,
  localScope,
}: {
  id: string
  extensions: string[]
  language: Parser.Language
  symbolFromNode: (file: string, node: SyntaxNode) => SymbolDefinition | undefined
  scopeFromNode?: (file: string, node: SyntaxNode) => ScopeDefinition | undefined
  callFromNode: (file: string, node: SyntaxNode) => CallSite | undefined
  importFromNode?: (node: SyntaxNode) => ImportRecord | undefined
  localScope?: (file: string, tree: Parser.Tree) => string | undefined
}): LanguageAdapter => ({
  id,
  extensions,
  language,
  extract: (file, _source, tree) => {
    const symbolNodes: Array<{ node: SyntaxNode; symbol: SymbolDefinition }> = []
    const scopeNodes: Array<{ node: SyntaxNode; scope: ScopeDefinition }> = []
    const callNodes: Array<{ node: SyntaxNode; call: CallSite }> = []
    const imports: ImportRecord[] = []
    const diagnostics: Diagnostic[] = []
    walk(tree.rootNode, (node) => {
      const foundSymbol = symbolFromNode(file, node)
      if (foundSymbol) symbolNodes.push({ node, symbol: foundSymbol })
      const foundScope = scopeFromNode?.(file, node)
      if (foundScope) scopeNodes.push({ node, scope: foundScope })
      const foundCall = callFromNode(file, node)
      if (foundCall) callNodes.push({ node, call: foundCall })
      const foundImport = importFromNode?.(node)
      if (foundImport) imports.push(foundImport)
    })
    for (const item of symbolNodes) {
      const owner = symbolNodes
        .filter((candidate) => candidate !== item && contains(candidate.node, item.node))
        .sort((a, b) => a.node.endIndex - a.node.startIndex - (b.node.endIndex - b.node.startIndex))[0]
      item.symbol.enclosingSymbolId = owner?.symbol.id
    }
    for (const item of scopeNodes) {
      const owner = scopeNodes
        .filter((candidate) => candidate !== item && contains(candidate.node, item.node))
        .sort((a, b) => a.node.endIndex - a.node.startIndex - (b.node.endIndex - b.node.startIndex))[0]
      item.scope.parentScopeId = owner?.scope.id
    }
    for (const item of callNodes) {
      const owner = symbolNodes
        .filter((candidate) => contains(candidate.node, item.node))
        .sort((a, b) => a.node.endIndex - a.node.startIndex - (b.node.endIndex - b.node.startIndex))[0]
      item.call.enclosingSymbolId = owner?.symbol.id
    }
    if (tree.rootNode.hasError) {
      diagnostics.push({
        kind: "parse-error",
        file,
        line: 1,
        column: 1,
        message: `Tree-sitter reported a parse error in ${file}`,
      })
    }
    return {
      path: file,
      language: id,
      localScope: localScope?.(file, tree),
      scopes: scopeNodes.map(({ scope: found }) => found),
      symbols: symbolNodes.map(({ symbol: found }) => found),
      calls: callNodes.map(({ call: found }) => found),
      imports,
      diagnostics,
    } satisfies ExtractedFile
  },
})

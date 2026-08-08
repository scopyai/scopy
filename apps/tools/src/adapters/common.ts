import { createHash } from "node:crypto"
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

const fileKeys = new Map<string, string>()

const fileKey = (file: string) => {
  const existing = fileKeys.get(file)
  if (existing) return existing
  const key = createHash("sha1").update(file).digest("hex").slice(0, 12)
  fileKeys.set(file, key)
  return key
}

const callSiteId = (file: string, node: SyntaxNode) =>
  `call:${fileKey(file)}:${node.startPosition.row + 1}:${node.startPosition.column + 1}`

const compactExpression = (value: string, maxLength = 320) =>
  value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 81)}…${value.slice(-80)}`

export const walk = (node: SyntaxNode, visit: (node: SyntaxNode) => void) => {
  const stack = [node]
  while (stack.length > 0) {
    const current = stack.pop()!
    visit(current)
    for (let index = current.namedChildCount - 1; index >= 0; index -= 1) {
      const child = current.namedChild(index)
      if (child) stack.push(child)
    }
  }
}

const MAX_PARSE_DIAGNOSTICS_PER_FILE = 50

const parseDiagnostics = (file: string, tree: Parser.Tree) => {
  if (!tree.rootNode.hasError) return []
  const diagnostics: Diagnostic[] = []
  const stack = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (diagnostics.length >= MAX_PARSE_DIAGNOSTICS_PER_FILE) break
    if (node.type === "ERROR" || node.isMissing) {
      diagnostics.push({
        kind: "parse-error",
        file,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        message: node.isMissing
          ? `Tree-sitter expected ${node.type} in ${file}`
          : `Tree-sitter could not parse ${node.text.slice(0, 120)} in ${file}`,
      })
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index)
      if (child) stack.push(child)
    }
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      kind: "parse-error",
      file,
      line: tree.rootNode.startPosition.row + 1,
      column: tree.rootNode.startPosition.column + 1,
      message: `Tree-sitter reported an unlocated parse error in ${file}`,
    })
  }
  return diagnostics
}

export const ancestor = (
  node: SyntaxNode | null,
  predicate: (candidate: SyntaxNode) => boolean
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

type LocatedNode<TValue> = { node: SyntaxNode; value: TValue }

const byStartThenWidest = <TValue>(
  left: LocatedNode<TValue>,
  right: LocatedNode<TValue>
) =>
  left.node.startIndex - right.node.startIndex ||
  right.node.endIndex - left.node.endIndex

const assignNestedOwners = <TValue>(
  items: LocatedNode<TValue>[],
  assign: (item: TValue, owner: TValue | undefined) => void
) => {
  const stack: LocatedNode<TValue>[] = []
  for (const item of [...items].sort(byStartThenWidest)) {
    while (
      stack.length > 0 &&
      !contains(stack[stack.length - 1]!.node, item.node)
    ) {
      stack.pop()
    }
    assign(item.value, stack.at(-1)?.value)
    stack.push(item)
  }
}

const assignPointOwners = <TContainer, TPoint>(
  containers: LocatedNode<TContainer>[],
  points: LocatedNode<TPoint>[],
  assign: (point: TPoint, owner: TContainer | undefined) => void
) => {
  const events = [
    ...containers.map((item) => ({ ...item, kind: "container" as const })),
    ...points.map((item) => ({ ...item, kind: "point" as const })),
  ].sort((left, right) => {
    const position = left.node.startIndex - right.node.startIndex
    if (position !== 0) return position
    if (left.kind !== right.kind) return left.kind === "container" ? -1 : 1
    return right.node.endIndex - left.node.endIndex
  })
  const stack: Array<LocatedNode<TContainer>> = []
  for (const event of events) {
    while (
      stack.length > 0 &&
      !contains(stack[stack.length - 1]!.node, event.node)
    ) {
      stack.pop()
    }
    if (event.kind === "container") stack.push(event)
    else assign(event.value, stack.at(-1)?.value)
  }
}

export const symbol = ({
  file,
  node,
  name,
  kind = "function",
  signature,
  parameters,
  returnType,
  containerName,
  exported = true,
}: {
  file: string
  node: SyntaxNode
  name: string
  kind?: SymbolDefinition["kind"]
  signature?: string
  parameters?: string[]
  returnType?: string
  containerName?: string
  exported?: boolean
}): SymbolDefinition => ({
  id: `${file}:${node.startPosition.row + 1}:${node.startPosition.column + 1}:${name}`,
  file,
  line: node.startPosition.row + 1,
  column: node.startPosition.column + 1,
  name,
  kind,
  signature,
  parameters,
  returnType,
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
  id: callSiteId(file, node),
  file,
  line: node.startPosition.row + 1,
  column: node.startPosition.column + 1,
  name,
  callee: compactExpression(callee),
  kind,
  receiver: receiver ? compactExpression(receiver) : undefined,
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
  symbolFromNode: (
    file: string,
    node: SyntaxNode
  ) => SymbolDefinition | undefined
  scopeFromNode?: (
    file: string,
    node: SyntaxNode
  ) => ScopeDefinition | undefined
  callFromNode: (file: string, node: SyntaxNode) => CallSite | undefined
  importFromNode?: (node: SyntaxNode) => ImportRecord | undefined
  localScope?: (file: string, tree: Parser.Tree) => string | undefined
}): LanguageAdapter => ({
  id,
  extensions,
  language,
  extract: (file, _source, tree) => {
    const symbolNodes: Array<{ node: SyntaxNode; symbol: SymbolDefinition }> =
      []
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
    assignNestedOwners(
      symbolNodes.map(({ node, symbol: found }) => ({ node, value: found })),
      (item, owner) => {
        item.enclosingSymbolId = owner?.id
      }
    )
    assignNestedOwners(
      scopeNodes.map(({ node, scope: found }) => ({ node, value: found })),
      (item, owner) => {
        item.parentScopeId = owner?.id
      }
    )
    assignPointOwners(
      symbolNodes.map(({ node, symbol: found }) => ({ node, value: found })),
      callNodes.map(({ node, call: found }) => ({ node, value: found })),
      (item, owner) => {
        item.enclosingSymbolId = owner?.id
      }
    )
    diagnostics.push(...parseDiagnostics(file, tree))
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

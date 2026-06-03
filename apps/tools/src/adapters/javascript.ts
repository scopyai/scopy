import type Parser from "tree-sitter"
import JavaScript from "tree-sitter-javascript"
import TypeScript from "tree-sitter-typescript"
import type { LanguageAdapter } from "./types"
import type {
  CallKind,
  CallSite,
  Diagnostic,
  ImportBinding,
  ImportRecord,
  SourceLocation,
  SymbolDefinition,
  SymbolKind,
} from "../types"

type SyntaxNode = Parser.SyntaxNode

const location = (file: string, node: SyntaxNode): SourceLocation => ({
  file,
  line: node.startPosition.row + 1,
  column: node.startPosition.column + 1,
})

const text = (node: SyntaxNode | null | undefined) => node?.text ?? ""

const walk = (node: SyntaxNode, visit: (node: SyntaxNode) => void) => {
  visit(node)
  for (const child of node.namedChildren) walk(child, visit)
}

const ancestor = (
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

const isFunctionValue = (node: SyntaxNode | null | undefined) =>
  node?.type === "arrow_function" ||
  node?.type === "function_expression" ||
  node?.type === "generator_function"

const propertyName = (node: SyntaxNode | null | undefined) => {
  if (!node) return ""
  if (
    node.type === "property_identifier" ||
    node.type === "identifier" ||
    node.type === "private_property_identifier"
  ) {
    return node.text
  }
  return ""
}

const classNameFor = (node: SyntaxNode) => {
  const classNode = ancestor(node.parent, (candidate) =>
    ["class_declaration", "class"].includes(candidate.type),
  )
  return text(classNode?.childForFieldName("name")) || undefined
}

const symbolFromNode = (
  file: string,
  node: SyntaxNode,
): Omit<SymbolDefinition, "enclosingSymbolId"> | undefined => {
  let name = ""
  let kind: SymbolKind = "function"
  let definitionNode = node
  let containerName: string | undefined

  if (
    node.type === "function_declaration" ||
    node.type === "generator_function_declaration"
  ) {
    name = text(node.childForFieldName("name"))
  } else if (node.type === "variable_declarator") {
    if (!isFunctionValue(node.childForFieldName("value"))) return undefined
    name = text(node.childForFieldName("name"))
  } else if (node.type === "method_definition") {
    name = propertyName(node.childForFieldName("name"))
    kind = node.parent?.type === "class_body" ? "method" : "object-method"
    containerName = kind === "method" ? classNameFor(node) : undefined
  } else if (node.type === "pair") {
    if (!isFunctionValue(node.childForFieldName("value"))) return undefined
    name = propertyName(node.childForFieldName("key"))
    kind = "object-method"
  } else {
    return undefined
  }

  if (!name) return undefined
  const exportNode = ancestor(node.parent, (candidate) =>
    ["export_statement", "program"].includes(candidate.type),
  )
  const isExport = exportNode?.type === "export_statement"
  const prefix = `${file}:${definitionNode.startPosition.row + 1}:${definitionNode.startPosition.column + 1}`

  return {
    id: `${prefix}:${name}`,
    name,
    kind,
    ...location(file, definitionNode),
    containerName,
    exported: isExport,
    defaultExport: Boolean(isExport && exportNode.text.startsWith("export default")),
  }
}

const contains = (outer: SyntaxNode, inner: SyntaxNode) =>
  outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex

const importBindings = (node: SyntaxNode): ImportBinding[] => {
  const bindings: ImportBinding[] = []
  walk(node, (candidate) => {
    if (candidate.type === "import_specifier") {
      const imported = text(candidate.childForFieldName("name"))
      bindings.push({
        imported,
        local: text(candidate.childForFieldName("alias")) || imported,
        kind: "named",
      })
    } else if (candidate.type === "namespace_import") {
      const local = candidate.namedChildren.find(
        (child) => child.type === "identifier",
      )
      if (local) bindings.push({ imported: "*", local: local.text, kind: "namespace" })
    }
  })

  const clause = node.namedChildren.find((child) => child.type === "import_clause")
  const defaultImport = clause?.namedChildren.find(
    (child) => child.type === "identifier",
  )
  if (defaultImport) {
    bindings.unshift({
      imported: "default",
      local: defaultImport.text,
      kind: "default",
    })
  }
  return bindings
}

const exportBindings = (node: SyntaxNode): ImportBinding[] => {
  const bindings: ImportBinding[] = []
  walk(node, (candidate) => {
    if (candidate.type !== "export_specifier") return
    const imported = text(candidate.childForFieldName("name"))
    bindings.push({
      imported,
      local: text(candidate.childForFieldName("alias")) || imported,
      kind: "named",
    })
  })
  if (node.text.startsWith("export *")) {
    bindings.push({ imported: "*", local: "*", kind: "namespace" })
  }
  return bindings
}

const importsFromNode = (node: SyntaxNode): ImportRecord | undefined => {
  if (node.type !== "import_statement" && node.type !== "export_statement") {
    return undefined
  }
  const source = node.childForFieldName("source")
  if (!source) return undefined
  const specifier = source.text.replace(/^["']|["']$/g, "")
  return {
    source: specifier,
    kind: node.type === "import_statement" ? "import" : "export",
    bindings:
      node.type === "import_statement" ? importBindings(node) : exportBindings(node),
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
  }
}

const callFromNode = (file: string, node: SyntaxNode): CallSite | undefined => {
  if (node.type !== "call_expression") return undefined
  const callee = node.childForFieldName("function")
  if (!callee) return undefined
  let name = ""
  let kind: CallKind
  let receiver: string | undefined

  if (callee.type === "identifier") {
    name = callee.text
    kind = "identifier"
  } else if (callee.type === "member_expression") {
    const object = callee.childForFieldName("object")
    name = propertyName(callee.childForFieldName("property"))
    receiver = text(object)
    kind = object?.type === "this" ? "this-method" : "member"
  } else {
    return undefined
  }

  if (!name) return undefined
  const at = location(file, node)
  return {
    id: `${file}:${at.line}:${at.column}:${callee.text}`,
    ...at,
    name,
    callee: callee.text,
    kind,
    receiver,
    confidence: "unresolved",
  }
}

const extract = (
  adapterId: string,
  file: string,
  _source: string,
  tree: Parser.Tree,
) => {
  const symbolNodes: Array<{ node: SyntaxNode; symbol: SymbolDefinition }> = []
  const calls: Array<{ node: SyntaxNode; call: CallSite }> = []
  const imports: ImportRecord[] = []
  const diagnostics: Diagnostic[] = []

  walk(tree.rootNode, (node) => {
    const symbol = symbolFromNode(file, node)
    if (symbol) symbolNodes.push({ node, symbol })
    const call = callFromNode(file, node)
    if (call) calls.push({ node, call })
    const importRecord = importsFromNode(node)
    if (importRecord) imports.push(importRecord)
  })

  for (const item of symbolNodes) {
    const owner = symbolNodes
      .filter((candidate) => candidate !== item && contains(candidate.node, item.node))
      .sort((a, b) => a.node.endIndex - a.node.startIndex - (b.node.endIndex - b.node.startIndex))[0]
    item.symbol.enclosingSymbolId = owner?.symbol.id
  }

  for (const item of calls) {
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
    language: adapterId,
    symbols: symbolNodes.map(({ symbol }) => symbol),
    calls: calls.map(({ call }) => call),
    imports,
    diagnostics,
  }
}

const adapter = (
  id: string,
  extensions: string[],
  language: Parser.Language,
): LanguageAdapter => ({
  id,
  extensions,
  language,
  extract: (file, source, tree) => extract(id, file, source, tree),
})

export const javascriptAdapters: LanguageAdapter[] = [
  adapter("javascript", [".js", ".mjs", ".cjs"], JavaScript as unknown as Parser.Language),
  adapter("jsx", [".jsx"], JavaScript as unknown as Parser.Language),
  adapter(
    "typescript",
    [".ts", ".mts", ".cts"],
    TypeScript.typescript as unknown as Parser.Language,
  ),
  adapter("tsx", [".tsx"], TypeScript.tsx as unknown as Parser.Language),
]

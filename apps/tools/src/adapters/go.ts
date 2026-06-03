import type Parser from "tree-sitter"
import path from "node:path"
import Go from "tree-sitter-go"
import type { ImportRecord } from "../types"
import { ancestor, call, createAdapter, symbol, text, walk, type SyntaxNode } from "./common"

const goImport = (node: SyntaxNode): ImportRecord | undefined => {
  if (node.type !== "import_spec") return undefined
  const source = text(node.childForFieldName("path")).replace(/^"|"$/g, "")
  if (!source) return undefined
  const alias = text(node.childForFieldName("name"))
  const dotImport = alias === "."
  return {
    source,
    resolution: "go-package",
    kind: "import",
    bindings: [{
      imported: "*",
      local: dotImport ? "*" : alias && alias !== "_" ? alias : source.split("/").at(-1)!,
      kind: dotImport ? "named" : "namespace",
    }],
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
  }
}

export const goAdapter = createAdapter({
  id: "go",
  extensions: [".go"],
  language: Go as unknown as Parser.Language,
  localScope: (file, tree) => {
    let packageName = ""
    walk(tree.rootNode, (node) => {
      if (node.type === "package_clause") packageName = node.namedChildren[0]?.text ?? ""
    })
    return packageName ? `go:${path.dirname(file)}:${packageName}` : undefined
  },
  symbolFromNode: (file, node) => {
    if (node.type === "function_declaration") {
      return symbol({ file, node, name: text(node.childForFieldName("name")) })
    }
    if (node.type !== "method_declaration") return undefined
    const receiver = node.childForFieldName("receiver")
    const typeNode = receiver?.namedChildren[0]?.childForFieldName("type")
    return symbol({
      file,
      node,
      name: text(node.childForFieldName("name")),
      kind: "method",
      containerName: text(typeNode) || undefined,
    })
  },
  callFromNode: (file, node) => {
    if (node.type !== "call_expression") return undefined
    const callee = node.childForFieldName("function")
    if (callee?.type === "identifier") {
      return call({ file, node, name: callee.text, callee: callee.text })
    }
    if (callee?.type !== "selector_expression") return undefined
    const receiver = text(callee.childForFieldName("operand"))
    const name = text(callee.childForFieldName("field"))
    const method = ancestor(node.parent, (candidate) => candidate.type === "method_declaration")
    const methodReceiver = method?.childForFieldName("receiver")
      ?.namedChildren[0]
      ?.childForFieldName("name")
      ?.text
    return call({
      file,
      node,
      name,
      callee: callee.text,
      receiver,
      kind: receiver === methodReceiver ? "this-method" : "member",
    })
  },
  importFromNode: goImport,
})

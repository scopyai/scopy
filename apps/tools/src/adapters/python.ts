import type Parser from "tree-sitter"
import Python from "tree-sitter-python"
import type { ImportRecord } from "../types"
import { ancestor, call, createAdapter, scope, symbol, text, type SyntaxNode } from "./common"

const pythonImport = (node: SyntaxNode): ImportRecord | undefined => {
  if (node.type === "import_from_statement") {
    const module = node.childForFieldName("module_name")
    if (!module) return undefined
    const bindings = node.childrenForFieldName("name").flatMap((name) => {
      if (name.type === "aliased_import") {
        const imported = text(name.childForFieldName("name"))
        return [{ imported, local: text(name.childForFieldName("alias")), kind: "named" as const }]
      }
      return [{ imported: name.text, local: name.text, kind: "named" as const }]
    })
    return {
      source: module.text,
      resolution: "python-module",
      kind: "import",
      bindings,
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    }
  }
  if (node.type !== "import_statement") return undefined
  const name = node.childForFieldName("name")
  if (!name) return undefined
  const imported = name.type === "aliased_import" ? text(name.childForFieldName("name")) : name.text
  return {
    source: imported,
    resolution: "python-module",
    kind: "import",
    bindings: [{
      imported: "*",
      local:
        name.type === "aliased_import"
          ? text(name.childForFieldName("alias"))
          : imported.split(".")[0]!,
      kind: "namespace",
    }],
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
  }
}

export const pythonAdapter = createAdapter({
  id: "python",
  extensions: [".py"],
  language: Python as unknown as Parser.Language,
  symbolFromNode: (file, node) => {
    if (node.type !== "function_definition") return undefined
    const classNode = ancestor(node.parent, (candidate) => candidate.type === "class_definition")
    return symbol({
      file,
      node,
      name: text(node.childForFieldName("name")),
      kind: classNode ? "method" : "function",
      containerName: text(classNode?.childForFieldName("name")) || undefined,
    })
  },
  scopeFromNode: (file, node) => {
    if (node.type === "class_definition") {
      return scope({
        file,
        node,
        name: text(node.childForFieldName("name")),
        kind: "class",
      })
    }
    if (node.type !== "function_definition") return undefined
    const classNode = ancestor(node.parent, (candidate) => candidate.type === "class_definition")
    return scope({
      file,
      node,
      name: text(node.childForFieldName("name")),
      kind: classNode ? "method" : "function",
    })
  },
  callFromNode: (file, node) => {
    if (node.type !== "call") return undefined
    const callee = node.childForFieldName("function")
    if (callee?.type === "identifier") {
      return call({ file, node, name: callee.text, callee: callee.text })
    }
    if (callee?.type !== "attribute") return undefined
    const receiver = text(callee.childForFieldName("object"))
    const name = text(callee.childForFieldName("attribute"))
    return call({
      file,
      node,
      name,
      callee: callee.text,
      receiver,
      kind: receiver === "self" ? "this-method" : "member",
    })
  },
  importFromNode: pythonImport,
})

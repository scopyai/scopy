import type Parser from "tree-sitter"
import Rust from "tree-sitter-rust"
import type { ImportRecord } from "../types"
import { ancestor, call, createAdapter, symbol, text, type SyntaxNode } from "./common"

const rustImport = (node: SyntaxNode): ImportRecord | undefined => {
  if (node.type === "mod_item") {
    const name = text(node.childForFieldName("name"))
    return {
      source: `self::${name}`,
      resolution: "rust-module",
      kind: "import",
      bindings: [{ imported: "*", local: name, kind: "namespace" }],
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    }
  }
  if (node.type !== "use_declaration") return undefined
  const argument = node.childForFieldName("argument")
  if (!argument) return undefined
  if (argument.type === "use_as_clause") {
    const importedPath = text(argument.childForFieldName("path"))
    const segments = importedPath.split("::")
    return {
      source: segments.slice(0, -1).join("::"),
      resolution: "rust-module",
      kind: "import",
      bindings: [{
        imported: segments.at(-1)!,
        local: text(argument.childForFieldName("alias")),
        kind: "named",
      }],
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    }
  }
  if (argument.type === "scoped_identifier") {
    const source = text(argument.childForFieldName("path"))
    const imported = text(argument.childForFieldName("name"))
    return {
      source,
      resolution: "rust-module",
      kind: "import",
      bindings: [{ imported, local: imported, kind: "named" }],
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    }
  }
  if (argument.type !== "scoped_use_list") return undefined
  const source = text(argument.childForFieldName("path"))
  const list = argument.childForFieldName("list")
  return {
    source,
    resolution: "rust-module",
    kind: "import",
    bindings: (list?.namedChildren ?? []).map((item) => ({
      imported: item.text,
      local: item.text,
      kind: "named",
    })),
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
  }
}

export const rustAdapter = createAdapter({
  id: "rust",
  extensions: [".rs"],
  language: Rust as unknown as Parser.Language,
  symbolFromNode: (file, node) => {
    if (node.type !== "function_item") return undefined
    const implNode = ancestor(node.parent, (candidate) => candidate.type === "impl_item")
    return symbol({
      file,
      node,
      name: text(node.childForFieldName("name")),
      kind: implNode ? "method" : "function",
      containerName: text(implNode?.childForFieldName("type")) || undefined,
    })
  },
  callFromNode: (file, node) => {
    if (node.type !== "call_expression") return undefined
    const callee = node.childForFieldName("function")
    if (callee?.type === "identifier") {
      return call({ file, node, name: callee.text, callee: callee.text })
    }
    if (callee?.type === "scoped_identifier") {
      const receiver = text(callee.childForFieldName("path"))
      const name = text(callee.childForFieldName("name"))
      return call({ file, node, name, callee: callee.text, receiver, kind: "member" })
    }
    if (callee?.type !== "field_expression") return undefined
    const receiver = text(callee.childForFieldName("value"))
    const name = text(callee.childForFieldName("field"))
    return call({
      file,
      node,
      name,
      callee: callee.text,
      receiver,
      kind: receiver === "self" ? "this-method" : "member",
    })
  },
  importFromNode: rustImport,
})

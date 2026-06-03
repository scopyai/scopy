import type Parser from "tree-sitter"
import Java from "tree-sitter-java"
import type { ImportRecord } from "../types"
import { ancestor, call, createAdapter, symbol, text, type SyntaxNode } from "./common"

const javaImport = (node: SyntaxNode): ImportRecord | undefined => {
  if (node.type !== "import_declaration") return undefined
  const imported = node.namedChildren[0]
  if (!imported) return undefined
  const staticImport = node.text.startsWith("import static ")
  const segments = imported.text.split(".")
  const local = segments.at(-1)!
  return {
    source: staticImport ? segments.slice(0, -1).join(".") : imported.text,
    resolution: "java-class",
    kind: "import",
    bindings: [{
      imported: staticImport ? local : "*",
      local,
      kind: staticImport ? "named" : "namespace",
    }],
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
  }
}

export const javaAdapter = createAdapter({
  id: "java",
  extensions: [".java"],
  language: Java as unknown as Parser.Language,
  symbolFromNode: (file, node) => {
    if (node.type !== "method_declaration" && node.type !== "constructor_declaration") {
      return undefined
    }
    const classNode = ancestor(node.parent, (candidate) => candidate.type === "class_declaration")
    return symbol({
      file,
      node,
      name: text(node.childForFieldName("name")),
      kind: "method",
      containerName: text(classNode?.childForFieldName("name")) || undefined,
    })
  },
  callFromNode: (file, node) => {
    if (node.type !== "method_invocation") return undefined
    const receiver = text(node.childForFieldName("object"))
    const name = text(node.childForFieldName("name"))
    return call({
      file,
      node,
      name,
      callee: receiver ? `${receiver}.${name}` : name,
      receiver: receiver || undefined,
      kind: receiver === "this" || !receiver ? "this-method" : "member",
    })
  },
  importFromNode: javaImport,
})

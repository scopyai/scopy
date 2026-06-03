import type Parser from "tree-sitter"
import type { ExtractedFile } from "../types"

export type LanguageAdapter = {
  id: string
  extensions: string[]
  language: Parser.Language
  extract: (file: string, source: string, tree: Parser.Tree) => ExtractedFile
}

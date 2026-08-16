import type Parser from "tree-sitter"
import type { ExtractedFile } from "../types"

export type LanguageAdapter = {
  id: string
  extensions: string[]
  language: Parser.Language
  parseSource?: (source: string) => string
  extract: (file: string, source: string, tree: Parser.Tree) => ExtractedFile
}

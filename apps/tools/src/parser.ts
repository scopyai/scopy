import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import Parser from "tree-sitter"
import { adaptersByExtension } from "./adapters"
import type { Diagnostic, ExtractedFile } from "./types"

export const parseRepositoryFile = async (
  repository: string,
  file: string,
): Promise<{ extracted?: ExtractedFile; diagnostics: Diagnostic[] }> => {
  const extension = path.extname(file)
  const adapter = adaptersByExtension.get(extension)
  if (!adapter) {
    return {
      diagnostics: [{
        kind: "unsupported-language",
        file,
        message: `No language adapter is registered for '${extension}' files`,
      }],
    }
  }
  const absoluteRepository = await realpath(repository)
  const source = await readFile(path.join(absoluteRepository, file), "utf8")
  const parser = new Parser()
  parser.setLanguage(adapter.language)
  const extracted = adapter.extract(file, source, parser.parse(source))
  return { extracted, diagnostics: extracted.diagnostics }
}

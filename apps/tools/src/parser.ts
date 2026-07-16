import path from "node:path"
import Parser from "tree-sitter"
import { adaptersByExtension } from "./adapters"
import { MAX_REPOSITORY_FILE_BYTES, readRepositoryTextFile, resolveRepositoryRoot } from "./repository-file"
import type { Diagnostic, ExtractedFile } from "./types"

export const parseRepositoryFile = async (
  repository: string,
  file: string,
): Promise<{
  source?: string
  extracted?: ExtractedFile
  diagnostics: Diagnostic[]
}> => {
  const extension = path.extname(file)
  const adapter = adaptersByExtension.get(extension)
  if (!adapter) {
    return {
      diagnostics: [
        {
          kind: "unsupported-language",
          file,
          message: `No language adapter is registered for '${extension}' files`,
        },
      ],
    }
  }
  const absoluteRepository = await resolveRepositoryRoot(repository)
  const { source } = await readRepositoryTextFile({
    repository: absoluteRepository,
    file,
    maxBytes: MAX_REPOSITORY_FILE_BYTES,
  })
  const parser = new Parser()
  parser.setLanguage(adapter.language)
  const extracted = adapter.extract(file, source, parser.parse(source))
  return { source, extracted, diagnostics: extracted.diagnostics }
}

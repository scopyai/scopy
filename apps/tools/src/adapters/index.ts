import type { LanguageAdapter } from "./types"
import { goAdapter } from "./go"
import { javaAdapter } from "./java"
import { javascriptAdapters } from "./javascript"
import { pythonAdapter } from "./python"
import { rustAdapter } from "./rust"

export const languageAdapters: LanguageAdapter[] = [
  ...javascriptAdapters,
  pythonAdapter,
  goAdapter,
  javaAdapter,
  rustAdapter,
]

export const adaptersByExtension = new Map<string, LanguageAdapter>(
  languageAdapters.flatMap((adapter) =>
    adapter.extensions.map((extension) => [extension, adapter]),
  ),
)

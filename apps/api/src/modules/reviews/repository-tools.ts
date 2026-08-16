import { tool } from "ai"
import {
  getSymbolCallers,
  getSymbolDefinition,
  readRepositoryFile,
  searchRepositoryText,
  type RepositoryCodeIndex,
} from "tools"
import { z } from "zod"
import type { ReviewRunRecorder } from "./debug-run"
import { truncateText } from "./text"

export type RepositoryToolOptions = {
  scope: string
  repositoryPath: string
  index: RepositoryCodeIndex
  recorder: ReviewRunRecorder
  onFileRead?: (file: string) => void
  onUse?: () => void
}

export const createRepositoryInspectionTools = ({
  scope,
  repositoryPath,
  index,
  recorder,
  onFileRead,
  onUse,
}: RepositoryToolOptions) => ({
  read_file: tool({
    description:
      "Read numbered repository lines. Reads 120 lines by default and up to 800. Request a larger maxLines only when the next range is required.",
    inputSchema: z.object({
      file: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().max(800).optional(),
    }),
    execute: async ({ file, startLine, maxLines = 120 }) => {
      onUse?.()
      const input = { file, startLine, maxLines }
      const output = await readRepositoryFile({
        repository: repositoryPath,
        file,
        startLine,
        maxLines,
      })
      onFileRead?.(file)
      await recorder.recordToolCall({
        name: `${scope}.read_file`,
        input,
        output,
      })
      return output
    },
  }),
  get_symbol_definition: tool({
    description:
      "Get symbol definitions, locations, and bounded source. Returns 3 definitions by default; use offset, limit, or maxSourceBytes to request more.",
    inputSchema: z.object({
      symbol: z.string().min(1),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(20).optional(),
      maxSourceBytes: z.number().int().min(1_000).max(40_000).optional(),
    }),
    execute: async ({ symbol, offset, limit, maxSourceBytes }) => {
      onUse?.()
      const input = { symbol, offset, limit, maxSourceBytes }
      const result = await getSymbolDefinition({
        repository: repositoryPath,
        index,
        symbol,
        offset,
        limit,
        maxSourceBytes,
      })
      for (const definition of result.json.definitions) {
        if (definition.source) onFileRead?.(definition.file)
      }
      const output = { ...result.json, stats: result.stats }
      await recorder.recordToolCall({
        name: `${scope}.get_symbol_definition`,
        input,
        output,
      })
      return output
    },
  }),
  get_symbol_callers: tool({
    description:
      "Get direct callers in pages. Returns 8 callers by default; use offset and limit to request more.",
    inputSchema: z.object({
      symbol: z.string().min(1),
      offset: z.number().int().nonnegative().max(199).optional(),
      limit: z.number().int().positive().max(50).optional(),
    }),
    execute: async ({ symbol, offset, limit }) => {
      onUse?.()
      const input = { symbol, offset, limit }
      const result = await getSymbolCallers({
        repository: repositoryPath,
        index,
        symbol,
        offset,
        limit,
      })
      const output = { ...result.json, stats: result.stats }
      await recorder.recordToolCall({
        name: `${scope}.get_symbol_callers`,
        input,
        output,
      })
      return output
    },
  }),
  locate_text: tool({
    description:
      "Search exact text across repository files. Returns 12 matches by default; request up to 50 with limit.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
    }),
    execute: async ({ query, limit = 12 }) => {
      onUse?.()
      const result = await searchRepositoryText({
        repository: repositoryPath,
        index,
        query,
        maxResults: limit,
      })
      const output = {
        ...result.stats,
        markdown: truncateText(result.markdown, 12_000),
      }
      await recorder.recordToolCall({
        name: `${scope}.locate_text`,
        input: { query, limit },
        output,
      })
      return output
    },
  }),
})

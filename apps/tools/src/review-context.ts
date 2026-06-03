import { buildDiffContext, type DiffContextResult } from "./diff/context"
import { parseUnifiedDiff } from "./diff/parse"
import { renderReadableDiffContext } from "./diff/render-readable"
import { prepareRepository } from "./repository"

export type BuildReviewDiffContextInput = {
  repository: string
  diff: string
  ref?: string
  keepTemporaryRepository?: boolean
}

export type BuildReviewDiffContextOutput = {
  repositoryPath: string
  json: DiffContextResult
  markdown: string
  stats: {
    files: number
    affectedSymbols: number
    diagnostics: number
    bytes: number
  }
}

export const buildReviewDiffContext = async ({
  repository,
  diff,
  ref,
  keepTemporaryRepository = false,
}: BuildReviewDiffContextInput): Promise<BuildReviewDiffContextOutput> => {
  const prepared = await prepareRepository({ repository, ref })
  try {
    const json = await buildDiffContext({
      repository: prepared.path,
      diffFiles: parseUnifiedDiff(diff),
    })
    const markdown = renderReadableDiffContext(json)
    return {
      repositoryPath: prepared.path,
      json,
      markdown,
      stats: {
        files: json.files.length,
        affectedSymbols: json.files.reduce(
          (total, file) => total + file.affectedSymbols.length,
          0,
        ),
        diagnostics: json.diagnostics.length,
        bytes: Buffer.byteLength(markdown, "utf8"),
      },
    }
  } finally {
    if (!keepTemporaryRepository) {
      await prepared.cleanup()
    }
  }
}

#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { stdin } from "node:process"
import { buildDiffContext } from "./diff/context"
import { parseUnifiedDiff } from "./diff/parse"
import { renderReadableDiffContext } from "./diff/render-readable"

const getArgument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const readStdin = async () => {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

const repository = getArgument("--repo")
const diffFile = getArgument("--diff-file")
const useStdin = process.argv.includes("--stdin")
const readable = process.argv.includes("--readable")

if (!repository || (!diffFile && !useStdin)) {
  console.error(
    "Usage: pnpm --filter tools diff-context --repo /full/path/to/repository (--diff-file /path/to/pr.diff | --stdin)",
  )
  process.exitCode = 1
} else {
  try {
    const diff = useStdin ? await readStdin() : await readFile(diffFile!, "utf8")
    const result = await buildDiffContext({
      repository,
      diffFiles: parseUnifiedDiff(diff),
    })
    console.log(readable ? renderReadableDiffContext(result) : JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

#!/usr/bin/env node
import { analyzeRepository } from "./analyze"

const getArgument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const repository = getArgument("--repo")
const functionName = getArgument("--function")

if (!repository || !functionName) {
  console.error(
    "Usage: pnpm --filter tools analyze --repo /full/path/to/repository --function functionName [--direct-only] [--include-graph]",
  )
  process.exitCode = 1
} else {
  try {
    const result = await analyzeRepository({
      repository,
      functionName,
      includeGraph: process.argv.includes("--include-graph"),
      directOnly: process.argv.includes("--direct-only"),
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

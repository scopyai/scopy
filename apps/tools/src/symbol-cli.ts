#!/usr/bin/env node
import { inspectSymbol } from "./symbol-inspect"
import { renderReadableSymbolInspection } from "./symbol-readable"

const getArgument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const repository = getArgument("--repo")
const ref = getArgument("--ref")
const symbol = getArgument("--symbol") ?? getArgument("--function")
const includeCallers =
  process.argv.includes("--include-callers") || process.argv.includes("--callers")
const includeCallerDefinitions = process.argv.includes("--include-caller-definitions")
const includeUnresolved = !process.argv.includes("--no-unresolved")
const readable = process.argv.includes("--readable")
const keepTemp = process.argv.includes("--keep-temp")

if (!repository || !symbol) {
  console.error(
    "Usage: pnpm --filter tools inspect-symbol --repo /full/path-or-owner/repo --symbol symbolName [--ref ref] [--include-callers] [--include-caller-definitions] [--readable]",
  )
  process.exitCode = 1
} else {
  try {
    const result = await inspectSymbol({
      repository,
      ref,
      symbol,
      includeCallers,
      includeDefinitionSource: readable,
      includeParentSource: readable,
      includeCallerDefinitions,
      includeUnresolved,
      keepTemporaryRepository: keepTemp,
    })
    console.log(readable ? renderReadableSymbolInspection(result) : JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

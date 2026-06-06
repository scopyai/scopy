import type { InspectSymbolResult } from "./symbol-inspect"

const fenced = (language: string | undefined, source: string) =>
  [`\`\`\`${language ?? ""}`, source, "```"].join("\n")

const languageForFile = (file: string) => {
  if (file.endsWith(".ts") || file.endsWith(".tsx")) return "ts"
  if (file.endsWith(".js") || file.endsWith(".jsx")) return "js"
  if (file.endsWith(".py")) return "py"
  if (file.endsWith(".go")) return "go"
  if (file.endsWith(".java")) return "java"
  if (file.endsWith(".rs")) return "rust"
  return undefined
}

export const renderReadableSymbolInspection = (result: InspectSymbolResult) => {
  const lines: string[] = [
    `# Symbol: ${result.query.symbol}`,
    "",
    `Repository: ${result.repositoryPath}`,
    "",
    "## Definitions",
  ]

  if (result.definitions.length === 0) {
    lines.push("", "No matching definitions found.")
  }

  for (const definition of result.definitions) {
    lines.push(
      "",
      `### ${definition.signature ?? definition.name} (${definition.kind})`,
      "",
      `${definition.file}:${definition.line}:${definition.column}`,
    )
    if (definition.source) {
      lines.push("", fenced(languageForFile(definition.file), definition.source))
    }
    if (definition.parentScope?.source) {
      lines.push(
        "",
        `Parent ${definition.parentScope.kind}: ${definition.parentScope.name}`,
        "",
        fenced(languageForFile(definition.parentScope.file), definition.parentScope.source),
      )
    }
  }

  if (result.callers) {
    lines.push("", "## Direct Callers")
    for (const group of result.callers) {
      const definition = result.definitions.find(
        (candidate) => candidate.id === group.definitionId,
      )
      lines.push(
        "",
        `### ${definition?.signature ?? definition?.name ?? group.definitionId}`,
        "",
        `Definition: ${group.definitionId}`,
      )
      if (group.directCallers.length === 0) {
        lines.push("", "No resolved direct callers found.")
        continue
      }
      for (const caller of group.directCallers) {
        lines.push(
          "",
          `- ${caller.file}:${caller.line}:${caller.column}`,
          `  - call: ${caller.callLine.trim()}`,
          `  - enclosing: ${caller.enclosingSymbol?.signature ?? caller.enclosingSymbol?.name ?? "top-level"}`,
        )
        if (caller.enclosingSymbol?.source) {
          lines.push(
            "",
            fenced(languageForFile(caller.enclosingSymbol.file), caller.enclosingSymbol.source),
          )
        }
      }
    }
  }

  if (result.unresolvedCandidates?.length) {
    lines.push("", "## Unresolved Same-Name Calls")
    for (const candidate of result.unresolvedCandidates) {
      lines.push(
        "",
        `- ${candidate.file}:${candidate.line}:${candidate.column} (${candidate.confidence})`,
        `  - call: ${candidate.callLine.trim()}`,
        `  - enclosing: ${candidate.enclosingSymbol?.signature ?? candidate.enclosingSymbol?.name ?? "top-level"}`,
      )
    }
  }

  if (result.diagnostics.length > 0) {
    lines.push("", "## Diagnostics")
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
        : "repository"
      lines.push("", `- ${location}: ${diagnostic.message}`)
    }
  }

  return lines.join("\n")
}

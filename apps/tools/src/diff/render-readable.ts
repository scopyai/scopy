import type { DiffContextResult } from "./context"

const languageFor = (language?: string) => {
  if (language === "typescript" || language === "tsx") return "ts"
  if (language === "javascript" || language === "jsx") return "js"
  if (language === "python") return "py"
  if (language === "rust") return "rust"
  return language ?? "text"
}

export const renderReadableDiffContext = (result: DiffContextResult) => {
  const sections = [
    "# Diff Context",
    "",
    `Repository: ${result.repository}`,
    `Files: ${result.files.length}`,
    `Affected symbols: ${result.files.reduce((total, file) => total + file.affectedSymbols.length, 0)}`,
    "",
  ]

  if (result.diagnostics.length > 0) {
    sections.push("## Diagnostics", "")
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
        : "repository"
      sections.push(`- ${diagnostic.kind} ${location}: ${diagnostic.message}`)
    }
    sections.push("")
  }

  for (const file of result.files) {
    sections.push(`## ${file.file}`, "", `Status: ${file.status}`, "")
    sections.push("### Diff", "", "```diff", file.patch, "```", "")

    if (file.affectedSymbols.length > 0) {
      sections.push("### Affected Symbols", "")
      for (const symbol of file.affectedSymbols) {
        sections.push(
          `#### ${symbol.kind} ${symbol.signature ?? symbol.name} (${symbol.startLine}-${symbol.endLine})`,
          "",
          `Touched lines: ${symbol.touchedLines.join(", ")}`,
          "",
          `\`\`\`${languageFor(file.language)}`,
          symbol.source,
          "```",
          "",
        )
      }
    }

    if (file.topLevelChangedLines.length > 0) {
      sections.push(
        "### Top-Level Changes",
        "",
        `Changed lines outside known symbols: ${file.topLevelChangedLines.join(", ")}`,
        "",
      )
    }
  }

  return sections.join("\n")
}

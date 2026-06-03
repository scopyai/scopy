import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { parseRepositoryFile } from "../parser"
import type { Diagnostic, ScopeDefinition } from "../types"
import type { ParsedDiffFile, ParsedDiffHunk } from "./parse"

export type AffectedSymbol = {
  id: string
  file: string
  name: string
  kind: Exclude<ScopeDefinition["kind"], "top-level">
  startLine: number
  endLine: number
  parentScopeId?: string
  touchedLines: number[]
  source: string
}

export type DiffContextFile = {
  file: string
  status: ParsedDiffFile["status"]
  language?: string
  patch: string
  affectedSymbols: AffectedSymbol[]
  topLevelChangedLines: number[]
}

export type DiffContextResult = {
  repository: string
  files: DiffContextFile[]
  diagnostics: Diagnostic[]
}

const lineSlice = (source: string, startLine: number, endLine: number) =>
  source.split(/\r?\n/).slice(startLine - 1, endLine).join("\n")

const renderDiffLine = (line: ParsedDiffHunk["lines"][number]) => {
  if (line.kind === "added") return `+${line.content}`
  if (line.kind === "removed") return `-${line.content}`
  return ` ${line.content}`
}

const renderHunkPatch = (hunk: ParsedDiffHunk) =>
  [hunk.header, ...hunk.lines.map(renderDiffLine)].join("\n")

const renderFilePatch = (diffFile: ParsedDiffFile, file: string) =>
  [
    `diff --git a/${diffFile.oldPath ?? file} b/${diffFile.newPath ?? file}`,
    `--- ${diffFile.oldPath === "/dev/null" ? "/dev/null" : `a/${diffFile.oldPath ?? file}`}`,
    `+++ ${diffFile.newPath === "/dev/null" ? "/dev/null" : `b/${diffFile.newPath ?? file}`}`,
    ...diffFile.hunks.map(renderHunkPatch),
  ].join("\n")

const smallestScopeContaining = (scopes: ScopeDefinition[], line: number) =>
  scopes
    .filter((scope) => scope.startLine <= line && scope.endLine >= line)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0]

const promoteScope = (
  scopesById: Map<string, ScopeDefinition>,
  scope: ScopeDefinition,
) => {
  let current = scope
  while (current.parentScopeId) {
    const parent = scopesById.get(current.parentScopeId)
    if (!parent) break
    if (parent.kind === "class") return parent
    current = parent
  }
  return scope
}

const topLevelScope = (file: string, line: number, source: string): ScopeDefinition => {
  const totalLines = source.split(/\r?\n/).length
  const startLine = Math.max(1, line - 20)
  const endLine = Math.min(totalLines, line + 20)
  return {
    id: `${file}:${startLine}:${endLine}:top-level`,
    file,
    line: startLine,
    column: 1,
    name: "top-level",
    kind: "top-level",
    startLine,
    endLine,
    startIndex: 0,
    endIndex: 0,
  }
}

export const buildDiffContext = async ({
  repository: inputRepository,
  diffFiles,
}: {
  repository: string
  diffFiles: ParsedDiffFile[]
}): Promise<DiffContextResult> => {
  const repository = await realpath(inputRepository)
  const diagnostics: Diagnostic[] = []
  const files: DiffContextFile[] = []

  for (const diffFile of diffFiles) {
    const file = diffFile.newPath && diffFile.newPath !== "/dev/null"
      ? diffFile.newPath
      : diffFile.oldPath
    if (!file) continue
    if (diffFile.status === "deleted" || !diffFile.newPath || diffFile.newPath === "/dev/null") {
      diagnostics.push({
        kind: "unresolved-call",
        file,
        message: `Cannot extract AST scopes for deleted file ${file}`,
      })
      files.push({
        file,
        status: diffFile.status,
        patch: renderFilePatch(diffFile, file),
        affectedSymbols: [],
        topLevelChangedLines: [],
      })
      continue
    }

    const source = await readFile(path.join(repository, file), "utf8")
    const parsed = await parseRepositoryFile(repository, file)
    diagnostics.push(...parsed.diagnostics)
    if (!parsed.extracted) {
      files.push({
        file,
        status: diffFile.status,
        patch: renderFilePatch(diffFile, file),
        affectedSymbols: [],
        topLevelChangedLines: [],
      })
      continue
    }

    const scopesById = new Map(parsed.extracted.scopes.map((scope) => [scope.id, scope]))
    const affected = new Map<string, { scope: ScopeDefinition; touchedLines: Set<number> }>()
    const topLevelChangedLines = new Set<number>()
    for (const hunk of diffFile.hunks) {
      const touchedLines =
        hunk.touchedNewLines.length > 0 ? hunk.touchedNewLines : hunk.anchorNewLines.slice(0, 1)
      if (hunk.touchedNewLines.length === 0) {
        diagnostics.push({
          kind: "unresolved-call",
          file,
          line: touchedLines[0],
          column: 1,
          message: `Hunk ${hunk.header} has no added/modified new-side lines; using nearest context line as scope anchor`,
        })
      }
      for (const line of touchedLines) {
        const smallest = smallestScopeContaining(parsed.extracted.scopes, line)
        const selected = smallest ? promoteScope(scopesById, smallest) : topLevelScope(file, line, source)
        if (selected.kind === "top-level") {
          topLevelChangedLines.add(line)
          continue
        }
        const existing = affected.get(selected.id)
        if (existing) {
          existing.touchedLines.add(line)
        } else {
          affected.set(selected.id, { scope: selected, touchedLines: new Set([line]) })
        }
      }
    }

    files.push({
      file,
      status: diffFile.status,
      language: parsed.extracted.language,
      patch: renderFilePatch(diffFile, file),
      topLevelChangedLines: [...topLevelChangedLines].sort((a, b) => a - b),
      affectedSymbols: [...affected.values()]
        .sort((a, b) => a.scope.startLine - b.scope.startLine)
        .map(({ scope, touchedLines }) => ({
          id: scope.id,
          file,
          name: scope.name,
          kind: scope.kind as Exclude<ScopeDefinition["kind"], "top-level">,
          startLine: scope.startLine,
          endLine: scope.endLine,
          parentScopeId: scope.parentScopeId,
          touchedLines: [...touchedLines].sort((a, b) => a - b),
          source: lineSlice(source, scope.startLine, scope.endLine),
        })),
    })
  }

  return { repository, files, diagnostics }
}

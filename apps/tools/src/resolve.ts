import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import type {
  CallEdge,
  CallSite,
  Diagnostic,
  ExtractedFile,
  FileDependencyEdge,
  ImportBinding,
  ImportRecord,
  SymbolDefinition,
} from "./types"

type PackageEntry = {
  name: string
  root: string
  entry?: string
  exports?: Record<string, unknown>
}

type ImportContext = {
  dependency: FileDependencyEdge
  bindings: ImportBinding[]
}

type TsconfigPaths = {
  root: string
  baseUrl: string
  paths: Record<string, string[]>
}

const supportedExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".rs",
]

type ResolvedImport = {
  file?: string
  localScope?: string
}

const exists = async (candidate: string) => {
  try {
    return (await stat(candidate)).isFile()
  } catch {
    return false
  }
}

const stripJsonComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const readJson = async (file: string) => {
  try {
    return JSON.parse(stripJsonComments(await readFile(file, "utf8"))) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const resolveFile = async (repository: string, rawCandidate: string) => {
  const candidate = path.resolve(repository, rawCandidate)
  const candidates = [
    candidate,
    ...supportedExtensions.map((extension) => `${candidate}${extension}`),
    ...supportedExtensions.map((extension) => path.join(candidate, `index${extension}`)),
    ...supportedExtensions.map((extension) => path.join(candidate, `mod${extension}`)),
  ]
  for (const file of candidates) {
    if (await exists(file)) return path.relative(repository, file)
  }
  return undefined
}

const resolvePythonModule = async (repository: string, importer: string, source: string) => {
  const dots = source.match(/^\.+/)?.[0].length ?? 0
  let base = dots ? path.dirname(importer) : "."
  for (let index = 1; index < dots; index += 1) base = path.dirname(base)
  const candidate = path.join(base, source.slice(dots).replaceAll(".", "/"))
  return resolveFile(repository, candidate)
}

const findNearestManifestDirectory = (
  importer: string,
  manifest: string,
  repositoryFiles: Set<string>,
) => {
  let directory = path.dirname(importer)
  while (directory !== ".") {
    if (repositoryFiles.has(path.join(directory, manifest))) return directory
    directory = path.dirname(directory)
  }
  return repositoryFiles.has(manifest) ? "." : undefined
}

const resolveRustModule = async ({
  repository,
  importer,
  source,
  repositoryFiles,
}: {
  repository: string
  importer: string
  source: string
  repositoryFiles: Set<string>
}) => {
  const segments = source.split("::")
  let base = path.dirname(importer)
  if (segments[0] === "crate") {
    const crate = findNearestManifestDirectory(importer, "Cargo.toml", repositoryFiles)
    if (crate === undefined) return undefined
    base = path.join(crate, "src")
    segments.shift()
  } else if (segments[0] === "self") {
    segments.shift()
  } else {
    while (segments[0] === "super") {
      base = path.dirname(base)
      segments.shift()
    }
  }
  return resolveFile(repository, path.join(base, ...segments))
}

const resolveJavaClass = async (
  source: string,
  repositoryFiles: Set<string>,
) => {
  const suffix = `${source.replaceAll(".", "/")}.java`
  const matches = [...repositoryFiles].filter(
    (file) => file === suffix || file.endsWith(`/${suffix}`),
  )
  return matches.length === 1 ? matches[0] : undefined
}

const findGoModules = async (repository: string, repositoryFiles: string[]) => {
  const modules: Array<{ module: string; root: string }> = []
  for (const file of repositoryFiles.filter((candidate) => path.basename(candidate) === "go.mod")) {
    const source = await readFile(path.join(repository, file), "utf8")
    const module = source.match(/^\s*module\s+(\S+)/m)?.[1]
    if (module) modules.push({ module, root: path.dirname(file) })
  }
  return modules.sort((a, b) => b.module.length - a.module.length)
}

const resolveGoPackage = (
  source: string,
  goModules: Awaited<ReturnType<typeof findGoModules>>,
  filesByDirectory: Map<string, ExtractedFile[]>,
): ResolvedImport | undefined => {
  const goModule = goModules.find(
    ({ module }) => source === module || source.startsWith(`${module}/`),
  )
  if (!goModule) return undefined
  const subpath = source === goModule.module ? "" : source.slice(goModule.module.length + 1)
  const directory = path.join(goModule.root, subpath)
  const files = filesByDirectory.get(directory)?.filter((file) => file.language === "go") ?? []
  const localScope = files.find((file) => file.localScope)?.localScope
  return files[0] ? { file: files[0].path, localScope } : undefined
}

const findTsconfigPaths = async (
  repository: string,
  files: string[],
): Promise<TsconfigPaths[]> => {
  const configs = files.filter((file) => path.basename(file) === "tsconfig.json")
  const paths: TsconfigPaths[] = []
  for (const file of configs) {
    const config = await readJson(path.join(repository, file))
    const compilerOptions = config?.compilerOptions as Record<string, unknown> | undefined
    const aliases = compilerOptions?.paths as Record<string, string[]> | undefined
    if (!aliases) continue
    paths.push({
      root: path.dirname(file),
      baseUrl:
        typeof compilerOptions?.baseUrl === "string" ? compilerOptions.baseUrl : ".",
      paths: aliases,
    })
  }
  return paths.sort((a, b) => b.root.length - a.root.length)
}

const resolveAlias = async (
  repository: string,
  importer: string,
  specifier: string,
  tsconfigs: TsconfigPaths[],
) => {
  for (const tsconfig of tsconfigs) {
    if (tsconfig.root !== "." && !importer.startsWith(`${tsconfig.root}/`)) continue
    for (const [pattern, replacements] of Object.entries(tsconfig.paths)) {
      const wildcardIndex = pattern.indexOf("*")
      const matches =
        wildcardIndex === -1
          ? specifier === pattern
          : specifier.startsWith(pattern.slice(0, wildcardIndex)) &&
            specifier.endsWith(pattern.slice(wildcardIndex + 1))
      if (!matches) continue
      const wildcard =
        wildcardIndex === -1
          ? ""
          : specifier.slice(
              wildcardIndex,
              specifier.length - (pattern.length - wildcardIndex - 1),
            )
      for (const replacement of replacements) {
        const resolved = await resolveFile(
          repository,
          path.join(
            tsconfig.root,
            tsconfig.baseUrl,
            replacement.replace("*", wildcard),
          ),
        )
        if (resolved) return resolved
      }
    }
  }
  return undefined
}

const findPackages = async (
  repository: string,
  files: string[],
): Promise<PackageEntry[]> => {
  const manifests = files.filter(
    (file) => path.basename(file) === "package.json" && !file.includes("node_modules/"),
  )
  const packages: PackageEntry[] = []
  for (const manifest of manifests) {
    const json = await readJson(path.join(repository, manifest))
    if (typeof json?.name !== "string") continue
    const root = path.dirname(manifest)
    const exports = json.exports
    const rootExport =
      typeof exports === "string"
        ? exports
        : typeof exports === "object" && exports
          ? (exports as Record<string, unknown>)["."]
          : undefined
    const entry =
      typeof rootExport === "string"
        ? rootExport
        : typeof rootExport === "object" && rootExport
          ? ((rootExport as Record<string, unknown>).types ??
            (rootExport as Record<string, unknown>).default)
          : (json.types ?? json.main)
    packages.push({
      name: json.name,
      root,
      entry: typeof entry === "string" ? entry : undefined,
      exports:
        typeof exports === "object" && exports
          ? (exports as Record<string, unknown>)
          : undefined,
    })
  }
  return packages
}

const resolvePackage = async (
  repository: string,
  specifier: string,
  packages: PackageEntry[],
) => {
  const workspacePackage = packages
    .sort((a, b) => b.name.length - a.name.length)
    .find(({ name }) => specifier === name || specifier.startsWith(`${name}/`))
  if (!workspacePackage) return undefined
  const requestedSubpath =
    specifier === workspacePackage.name
      ? "."
      : `./${specifier.slice(workspacePackage.name.length + 1)}`
  let subpath = requestedSubpath === "." ? workspacePackage.entry : undefined
  for (const [pattern, target] of Object.entries(workspacePackage.exports ?? {})) {
    const wildcardIndex = pattern.indexOf("*")
    const matches =
      wildcardIndex === -1
        ? requestedSubpath === pattern
        : requestedSubpath.startsWith(pattern.slice(0, wildcardIndex)) &&
          requestedSubpath.endsWith(pattern.slice(wildcardIndex + 1))
    if (!matches) continue
    const wildcard =
      wildcardIndex === -1
        ? ""
        : requestedSubpath.slice(
            wildcardIndex,
            requestedSubpath.length - (pattern.length - wildcardIndex - 1),
          )
    const exportTarget =
      typeof target === "string"
        ? target
        : typeof target === "object" && target
          ? ((target as Record<string, unknown>).types ??
            (target as Record<string, unknown>).default)
          : undefined
    if (typeof exportTarget === "string") {
      subpath = exportTarget.replace("*", wildcard)
      break
    }
  }
  return subpath
    ? resolveFile(repository, path.join(workspacePackage.root, subpath))
    : undefined
}

const resolveImport = async ({
  repository,
  importer,
  specifier,
  tsconfigs,
  packages,
  imported,
  repositoryFiles,
  goModules,
  filesByDirectory,
}: {
  repository: string
  importer: string
  specifier: string
  tsconfigs: TsconfigPaths[]
  packages: PackageEntry[]
  imported: ImportRecord
  repositoryFiles: Set<string>
  goModules: Awaited<ReturnType<typeof findGoModules>>
  filesByDirectory: Map<string, ExtractedFile[]>
}): Promise<ResolvedImport | undefined> => {
  if (imported.resolution === "python-module") {
    const file = await resolvePythonModule(repository, importer, specifier)
    return file ? { file } : undefined
  }
  if (imported.resolution === "rust-module") {
    const file = await resolveRustModule({
      repository,
      importer,
      source: specifier,
      repositoryFiles,
    })
    return file ? { file } : undefined
  }
  if (imported.resolution === "java-class") {
    const file = await resolveJavaClass(specifier, repositoryFiles)
    return file ? { file } : undefined
  }
  if (imported.resolution === "go-package") {
    return resolveGoPackage(specifier, goModules, filesByDirectory)
  }
  if (specifier.startsWith(".")) {
    const file = await resolveFile(repository, path.join(path.dirname(importer), specifier))
    return file ? { file } : undefined
  }
  const file =
    (await resolveAlias(repository, importer, specifier, tsconfigs)) ??
    (await resolvePackage(repository, specifier, packages))
  return file ? { file } : undefined
}

const cloneCall = (call: CallSite, confidence: CallSite["confidence"]): CallSite => ({
  ...call,
  confidence,
})

const uniqueSymbol = (symbols: SymbolDefinition[]) =>
  symbols.length === 1 ? symbols[0] : undefined

export const resolveGraphs = async ({
  repository,
  files,
  repositoryFiles,
}: {
  repository: string
  files: ExtractedFile[]
  repositoryFiles: string[]
}) => {
  const diagnostics: Diagnostic[] = []
  const dependencies: FileDependencyEdge[] = []
  const importsByFile = new Map<string, ImportContext[]>()
  const symbols = files.flatMap((file) => file.symbols)
  const symbolsByFile = new Map<string, SymbolDefinition[]>()
  const symbolsByLocalScope = new Map<string, SymbolDefinition[]>()
  const filesByDirectory = new Map<string, ExtractedFile[]>()
  for (const symbol of symbols) {
    symbolsByFile.set(symbol.file, [...(symbolsByFile.get(symbol.file) ?? []), symbol])
  }
  for (const file of files) {
    const directory = path.dirname(file.path)
    filesByDirectory.set(directory, [...(filesByDirectory.get(directory) ?? []), file])
    if (!file.localScope) continue
    symbolsByLocalScope.set(file.localScope, [
      ...(symbolsByLocalScope.get(file.localScope) ?? []),
      ...file.symbols,
    ])
  }

  const tsconfigs = await findTsconfigPaths(repository, repositoryFiles)
  const packages = await findPackages(repository, repositoryFiles)
  const goModules = await findGoModules(repository, repositoryFiles)
  const repositoryFileSet = new Set(repositoryFiles)
  for (const file of files) {
    const contexts: ImportContext[] = []
    for (const imported of file.imports) {
      const resolved = await resolveImport({
        repository,
        importer: file.path,
        specifier: imported.source,
        tsconfigs,
        packages,
        imported,
        repositoryFiles: repositoryFileSet,
        goModules,
        filesByDirectory,
      })
      const dependency: FileDependencyEdge = {
        from: file.path,
        specifier: imported.source,
        to: resolved?.file,
        toScope: resolved?.localScope,
        kind: imported.kind,
        resolved: Boolean(resolved?.file || resolved?.localScope),
      }
      dependencies.push(dependency)
      contexts.push({ dependency, bindings: imported.bindings })
      if (!resolved && imported.source.startsWith(".")) {
        diagnostics.push({
          kind: "unresolved-import",
          file: file.path,
          line: imported.line,
          column: imported.column,
          message: `Could not resolve repository-local import '${imported.source}' from ${file.path}`,
        })
      }
    }
    importsByFile.set(file.path, contexts)
  }

  const edges: CallEdge[] = []
  const unresolvedCalls: CallSite[] = []
  const resolveExportedSymbols = (
    file: string,
    name: string,
    visited = new Set<string>(),
  ): SymbolDefinition[] => {
    const visitKey = `${file}:${name}`
    if (visited.has(visitKey)) return []
    visited.add(visitKey)
    const direct = (symbolsByFile.get(file) ?? []).filter((symbol) =>
      name === "default" ? symbol.defaultExport : symbol.exported && symbol.name === name,
    )
    const forwarded = (importsByFile.get(file) ?? [])
      .filter(({ dependency }) => dependency.kind === "export" && dependency.to)
      .flatMap(({ dependency, bindings }) =>
        bindings.flatMap((binding) => {
          if (binding.local !== name && binding.local !== "*") return []
          return resolveExportedSymbols(
            dependency.to!,
            binding.local === "*" ? name : binding.imported,
            new Set(visited),
          )
        }),
      )
    return [...direct, ...forwarded]
  }

  for (const file of files) {
    for (const call of file.calls) {
      const imported = importsByFile
        .get(file.path)
        ?.flatMap((context) =>
          context.bindings.map((binding) => ({ context, binding })),
        )
      let candidates: SymbolDefinition[] = []

      if (call.kind === "identifier") {
        const importCandidates = (imported ?? [])
          .filter(({ binding }) => binding.local === call.name || binding.local === "*")
          .flatMap(({ binding, context }) => {
            if (context.dependency.toScope) {
              return (symbolsByLocalScope.get(context.dependency.toScope) ?? []).filter(
                (symbol) => symbol.name === call.name,
              )
            }
            if (!context.dependency.to) return []
            return binding.kind === "default"
              ? resolveExportedSymbols(context.dependency.to, "default")
              : resolveExportedSymbols(
                  context.dependency.to,
                  binding.imported === "*" ? call.name : binding.imported,
                )
          })
        const localCandidates = (
          file.localScope
            ? (symbolsByLocalScope.get(file.localScope) ?? [])
            : (symbolsByFile.get(file.path) ?? [])
        ).filter((symbol) => symbol.name === call.name)
        candidates = [...importCandidates, ...localCandidates]
      } else if (call.kind === "member" && call.receiver) {
        const namespace = imported?.find(
          ({ binding }) =>
            binding.kind === "namespace" && binding.local === call.receiver,
        )
        if (namespace?.context.dependency.toScope) {
          candidates = (symbolsByLocalScope.get(namespace.context.dependency.toScope) ?? []).filter(
            (symbol) => symbol.name === call.name,
          )
        } else if (namespace?.context.dependency.to) {
          candidates = resolveExportedSymbols(namespace.context.dependency.to, call.name)
        } else if (file.language === "java") {
          candidates = symbols.filter(
            (symbol) =>
              symbol.kind === "method" &&
              symbol.containerName === call.receiver &&
              symbol.name === call.name,
          )
        }
      } else if (call.kind === "this-method" && call.enclosingSymbolId) {
        const owner = symbols.find((symbol) => symbol.id === call.enclosingSymbolId)
        const binding = imported?.find(({ binding }) => binding.local === call.name)
        candidates =
          binding?.context.dependency.to
            ? resolveExportedSymbols(binding.context.dependency.to, binding.binding.imported)
            : (
                file.localScope
                  ? (symbolsByLocalScope.get(file.localScope) ?? [])
                  : (symbolsByFile.get(file.path) ?? [])
              ).filter(
                (symbol) =>
                  symbol.kind === "method" &&
                  symbol.containerName === owner?.containerName &&
                  symbol.name === call.name,
              )
      }

      const target = uniqueSymbol(candidates)
      if (target) {
        const callSite = cloneCall(call, "resolved")
        edges.push({
          id: `${call.id}->${target.id}`,
          callerSymbolId: call.enclosingSymbolId,
          calleeSymbolId: target.id,
          callSite,
          confidence: "resolved",
        })
      } else {
        const confidence = candidates.length > 1 ? "ambiguous" : "unresolved"
        unresolvedCalls.push(cloneCall(call, confidence))
        if (candidates.length > 1) {
          diagnostics.push({
            kind: "ambiguous-call",
            file: call.file,
            line: call.line,
            column: call.column,
            message: `Call '${call.callee}' has ${candidates.length} possible targets`,
          })
        }
      }
    }
  }

  return { dependencies, diagnostics, edges, unresolvedCalls, symbols }
}

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { docSourceConfigs } from "./sources"

export type DetectedDocLibrary = {
  slug: string
  name: string
  manifest: string
  dependency: string
}

const MAX_MANIFEST_FILES = 300
const MAX_WALK_DEPTH = 8
const MAX_MANIFEST_BYTES = 1_000_000

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "vendor",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
])

const isManifestFile = (fileName: string) =>
  fileName === "package.json" ||
  fileName === "pyproject.toml" ||
  fileName === "go.mod" ||
  fileName === "Cargo.toml" ||
  fileName === "Gemfile" ||
  fileName === "pom.xml" ||
  fileName === "build.gradle" ||
  fileName === "build.gradle.kts" ||
  /^requirements[\w.-]*\.txt$/.test(fileName)

const findManifestFiles = async (repoDir: string) => {
  const manifests: string[] = []
  const walk = async (dir: string, depth: number) => {
    if (depth > MAX_WALK_DEPTH || manifests.length >= MAX_MANIFEST_FILES) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (manifests.length >= MAX_MANIFEST_FILES) return
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith("."))
          continue
        await walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && isManifestFile(entry.name)) {
        manifests.push(path.relative(repoDir, path.join(dir, entry.name)))
      }
    }
  }
  await walk(repoDir, 0)
  return manifests.sort()
}

const parsePackageJson = (content: string) => {
  try {
    const parsed = JSON.parse(content) as Record<
      string,
      Record<string, string> | undefined
    >
    return [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
    ]
  } catch {
    return []
  }
}

const parseRequirementsTxt = (content: string) =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("-"))
    .map((line) => line.split(/[=<>!~;\[\s]/)[0]!.trim())
    .filter(Boolean)

const parsePyprojectToml = (content: string) => {
  const deps: string[] = []
  const dependencyArrays = content.matchAll(
    /^\s*(?:dependencies|[\w-]*requires)\s*=\s*\[([\s\S]*?)^\s*\]/gm
  )
  for (const match of dependencyArrays) {
    for (const quoted of match[1]!.matchAll(/["']([^"']+)["']/g)) {
      const name = quoted[1]!.split(/[=<>!~;\[\s]/)[0]!.trim()
      if (name) deps.push(name)
    }
  }
  const poetrySections = content.matchAll(
    /^\[tool\.poetry\.(?:dev-)?dependencies\]\s*\n((?:(?!^\[)[^\n]*\n?)*)/gm
  )
  for (const match of poetrySections) {
    for (const line of match[1]!.split("\n")) {
      const key = line.match(/^\s*([\w.-]+)\s*=/)
      if (key && key[1] !== "python") deps.push(key[1]!)
    }
  }
  return deps
}

const parseGoMod = (content: string) => {
  const deps: string[] = []
  const blocks = content.matchAll(/require\s*\(([^)]*)\)/gs)
  for (const match of blocks) {
    for (const line of match[1]!.split("\n")) {
      const entry = line.trim().match(/^([\w./~-]+)\s+v/)
      if (entry) deps.push(entry[1]!)
    }
  }
  for (const single of content.matchAll(/^require\s+([\w./~-]+)\s+v/gm)) {
    deps.push(single[1]!)
  }
  return deps
}

const parseCargoToml = (content: string) => {
  const deps: string[] = []
  const sections = content.matchAll(
    /^\[(?:workspace\.)?(?:dev-|build-)?dependencies\]\s*\n((?:(?!^\[)[^\n]*\n?)*)/gm
  )
  for (const match of sections) {
    for (const line of match[1]!.split("\n")) {
      const key = line.match(/^\s*([\w-]+)\s*=/)
      if (key) deps.push(key[1]!)
    }
  }
  return deps
}

const parseGemfile = (content: string) =>
  [...content.matchAll(/^\s*gem\s+["']([\w-]+)["']/gm)].map(
    (match) => match[1]!
  )

const parsePomXml = (content: string) => {
  const deps: string[] = []
  const dependencies = content.matchAll(
    /<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g
  )
  for (const match of dependencies) {
    deps.push(`${match[1]!.trim()}:${match[2]!.trim()}`)
    deps.push(match[2]!.trim())
  }
  return deps
}

const parseBuildGradle = (content: string) => {
  const deps: string[] = []
  const declarations = content.matchAll(
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor)\s*[( ]\s*["']([^"':]+):([^"':]+)(?::[^"']*)?["']/g
  )
  for (const match of declarations) {
    deps.push(`${match[1]!}:${match[2]!}`)
    deps.push(match[2]!)
  }
  return deps
}

const parseManifest = (fileName: string, content: string): string[] => {
  if (fileName === "package.json") return parsePackageJson(content)
  if (fileName === "pyproject.toml") return parsePyprojectToml(content)
  if (fileName === "go.mod") return parseGoMod(content)
  if (fileName === "Cargo.toml") return parseCargoToml(content)
  if (fileName === "Gemfile") return parseGemfile(content)
  if (fileName === "pom.xml") return parsePomXml(content)
  if (fileName === "build.gradle" || fileName === "build.gradle.kts")
    return parseBuildGradle(content)
  if (/^requirements[\w.-]*\.txt$/.test(fileName))
    return parseRequirementsTxt(content)
  return []
}

const normalizeKey = (value: string) =>
  value.toLowerCase().replace(/[\s_.]+/g, "-")

const LANGUAGE_SUFFIXES =
  /-(go|rs|rb|py|php|java|js|ts|node|dotnet|sdk|client)$/

const candidateKeys = (dependency: string): string[] => {
  const keys = new Set<string>()
  const normalized = normalizeKey(dependency)
  keys.add(normalized)
  if (normalized.startsWith("@")) {
    const unscoped = normalized.split("/")[1]
    if (unscoped) keys.add(unscoped)
  }
  if (normalized.includes("/")) {
    const withoutGoVersion = normalized.replace(/\/v\d+$/, "")
    keys.add(withoutGoVersion)
    const lastSegment = withoutGoVersion.split("/").pop()
    if (lastSegment) keys.add(lastSegment)
  }
  for (const key of [...keys]) {
    if (key.includes("/")) continue
    if (LANGUAGE_SUFFIXES.test(key)) {
      keys.add(key.replace(LANGUAGE_SUFFIXES, ""))
    }
    if (key.startsWith("go-")) {
      keys.add(key.slice(3))
    }
  }
  return [...keys]
}

const buildAliasIndex = () => {
  const index = new Map<string, { slug: string; name: string }>()
  for (const config of docSourceConfigs) {
    const target = { slug: config.slug, name: config.name }
    index.set(normalizeKey(config.slug), target)
    index.set(normalizeKey(config.name), target)
    for (const alias of config.aliases ?? []) {
      index.set(normalizeKey(alias), target)
    }
  }
  return index
}

export const detectDocLibraries = async (
  repoDir: string
): Promise<DetectedDocLibrary[]> => {
  const aliasIndex = buildAliasIndex()
  const manifests = await findManifestFiles(repoDir)
  const detectedBySlug = new Map<string, DetectedDocLibrary>()

  for (const manifest of manifests) {
    const content = await readFile(path.join(repoDir, manifest), "utf8").catch(
      () => null
    )
    if (!content || Buffer.byteLength(content, "utf8") > MAX_MANIFEST_BYTES) {
      continue
    }
    const dependencies = parseManifest(path.basename(manifest), content)
    for (const dependency of dependencies) {
      for (const key of candidateKeys(dependency)) {
        const match = aliasIndex.get(key)
        if (match && !detectedBySlug.has(match.slug)) {
          detectedBySlug.set(match.slug, {
            slug: match.slug,
            name: match.name,
            manifest,
            dependency,
          })
        }
      }
    }
  }

  return [...detectedBySlug.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug)
  )
}

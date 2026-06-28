function envVar(key: keyof ImportMetaEnv, fallback: string): string {
  const value = import.meta.env[key]
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export const env = {
  siteUrl: envVar("VITE_SITE_URL", "https://scopy.dev").replace(/\/+$/, ""),
  githubUrl: envVar("VITE_GITHUB_URL", "https://github.com/scopyai/scopy"),
  appUrl: envVar("VITE_APP_URL", "http://localhost:3000"),
  docsUrl: envVar("VITE_DOCS_URL", "/docs"),
  privacyUrl: envVar("VITE_PRIVACY_URL", "/privacy"),
  supportEmail: "support@scopy.dev",
} as const

export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

export function externalLinkProps(url: string) {
  if (!isExternalUrl(url)) return {}
  return { target: "_blank" as const, rel: "noopener noreferrer" }
}

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

// SSRF guard for the docs crawler: custom sources make it fetch
// user-supplied URLs, so every request (and every redirect hop) must resolve
// to a public address. DNS is re-checked right before each fetch; a TOCTOU
// rebinding window remains, but the worker has no HTTP-reachable internal
// services and cloud metadata ranges are blocked outright.

const isPrivateIpv4 = (ip: string) => {
  const parts = ip.split(".").map(Number)
  const [a, b] = parts
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true
  }
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b !== undefined && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // IETF reserved
    (a === 192 && b === 168) ||
    (a === 198 && b !== undefined && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  )
}

const isPrivateIp = (ip: string) => {
  if (isIP(ip) === 4) return isPrivateIpv4(ip)
  const normalized = ip.toLowerCase()
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") || // unique local fc00::/7
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || // link-local fe80::/10
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  )
}

/** Returns an error string when the URL must not be fetched, null when safe. */
export const checkUrlIsPublic = async (
  rawUrl: string
): Promise<string | null> => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return "invalid url"
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `unsupported protocol: ${url.protocol}`
  }
  if (url.username || url.password) {
    return "urls with credentials are not allowed"
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return "only default http(s) ports are allowed"
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(hostname)) {
    return isPrivateIp(hostname) ? "address is not public" : null
  }
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.length === 0) return "hostname did not resolve"
    if (addresses.some((entry) => isPrivateIp(entry.address))) {
      return "address is not public"
    }
    return null
  } catch {
    return "hostname did not resolve"
  }
}

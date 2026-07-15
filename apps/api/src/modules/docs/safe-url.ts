import { lookup } from "node:dns/promises"
import { lookup as lookupCb } from "node:dns"
import { isIP, type LookupFunction } from "node:net"
import { Agent } from "undici"

const IPV4_BLOCKED_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const

const ipv4ToNumber = (ip: string) => {
  const parts = ip.split(".").map(Number)
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255
    )
  ) {
    return null
  }
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0
}

const isIpv4InCidr = (ip: number, network: number, prefix: number) => {
  const shift = 32 - prefix
  return (ip >>> shift) === (network >>> shift)
}

const isPrivateIpv4 = (ip: string) => {
  const value = ipv4ToNumber(ip)
  if (value === null) return true
  return IPV4_BLOCKED_RANGES.some(([network, prefix]) => {
    const networkValue = ipv4ToNumber(network)!
    return isIpv4InCidr(value, networkValue, prefix)
  })
}

const ipv6ToBigInt = (ip: string) => {
  const normalized = ip.toLowerCase().split("%")[0]!
  if (normalized.includes(".")) return null
  const halves = normalized.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves[1] ? halves[1].split(":") : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ]
  if (
    parts.length !== 8 ||
    parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) {
    return null
  }
  return parts.reduce(
    (value, part) => (value << 16n) | BigInt(Number.parseInt(part, 16)),
    0n
  )
}

const ipv6InCidr = (ip: bigint, network: bigint, prefix: number) =>
  (ip >> BigInt(128 - prefix)) === (network >> BigInt(128 - prefix))

const ipv6Network = (ip: string) => ipv6ToBigInt(ip)!

const isPrivateIpv6 = (ip: string) => {
  const value = ipv6ToBigInt(ip)
  if (value === null) return true

  // Only globally routable unicast space is eligible. Explicitly exclude
  // special-use ranges which sit inside 2000::/3.
  if (!ipv6InCidr(value, ipv6Network("2000::"), 3)) return true
  return (
    ipv6InCidr(value, ipv6Network("2001::"), 23) ||
    ipv6InCidr(value, ipv6Network("2001:db8::"), 32) ||
    ipv6InCidr(value, ipv6Network("2002::"), 16) ||
    ipv6InCidr(value, ipv6Network("3fff::"), 20)
  )
}

const isPrivateIp = (ip: string) => {
  if (isIP(ip) === 4) return isPrivateIpv4(ip)
  if (isIP(ip) === 6) return isPrivateIpv6(ip)
  return true
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookupCb(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0)
    const resolved = Array.isArray(addresses) ? addresses : []
    if (resolved.length === 0) {
      return callback(new Error("hostname did not resolve"), "", 0)
    }
    const blocked = resolved.find((entry) => isPrivateIp(entry.address))
    if (blocked) {
      return callback(new Error("address is not public"), "", 0)
    }
    if (options.all) {
      return (callback as (err: Error | null, addrs: typeof resolved) => void)(
        null,
        resolved
      )
    }
    const first = resolved[0]!
    return callback(null, first.address, first.family)
  })
}

export const publicDispatcher = new Agent({
  connect: { lookup: publicOnlyLookup },
})

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

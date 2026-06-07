type RateLimitEntry = {
  count: number
  resetAt: number
}

const entries = new Map<string, RateLimitEntry>()
let nextCleanupAt = 0

export type RateLimitOptions = {
  key: string
  limit: number
  windowMs: number
}

export const checkRateLimit = ({ key, limit, windowMs }: RateLimitOptions) => {
  const now = Date.now()
  if (nextCleanupAt <= now) {
    for (const [entryKey, entry] of entries) {
      if (entry.resetAt <= now) {
        entries.delete(entryKey)
      }
    }
    nextCleanupAt = now + windowMs
  }

  const existing = entries.get(key)

  if (!existing || existing.resetAt <= now) {
    entries.set(key, {
      count: 1,
      resetAt: now + windowMs,
    })

    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: 0,
      resetAt: now + windowMs,
    }
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
      resetAt: existing.resetAt,
    }
  }

  existing.count += 1
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
    resetAt: existing.resetAt,
  }
}

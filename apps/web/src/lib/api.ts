import { treaty } from '@elysiajs/eden'
import type { App } from 'api'
import { env } from '@/env'

export const api = treaty<App>(env.VITE_API_BASE_URL, {
    fetch: { credentials: 'include' },
})

import { treaty } from '@elysiajs/eden'
import type { App } from '@api/app/base'
import { env } from '@/env'

export const api = treaty<App>(env.API_BASE_URL)

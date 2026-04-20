import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

export const env = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),
  UNOSEND_API_KEY: z.string().min(1),
  UNOSEND_FROM_EMAIL: z.string().email(),
}).parse(process.env)

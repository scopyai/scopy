import { resolve } from 'node:path'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ path: resolve(process.cwd(), '.env') })

export const env = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
}).parse(process.env)

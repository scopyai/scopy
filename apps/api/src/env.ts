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
  CREEM_API_KEY: z.string().min(1),
  CREEM_WEBHOOK_SECRET: z.string().min(1),
  CREEM_TEST_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  CREEM_PREMIUM_PRODUCT_ID: z.string().min(1),
  CREEM_ULTRA_PRODUCT_ID: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
}).parse(process.env)

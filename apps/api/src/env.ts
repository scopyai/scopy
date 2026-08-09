import { resolve } from "node:path"
import dotenv from "dotenv"
import { z } from "zod"

dotenv.config({ path: resolve(process.cwd(), ".env") })

export const sharedSchema = z.object({
  APP_ENV: z.enum(["dev", "prod"]).default("dev"),
  DATABASE_URL: z.string().min(1),
  FRONTEND_URL: z.url(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  VECTOR_WRITE_MICROUSD_PER_GIB: z.coerce.number().int().nonnegative().default(2_500_000),
  VECTOR_QUERY_MICROUSD_PER_TIB: z.coerce.number().int().nonnegative().default(7_500),
  VECTOR_NETWORK_MICROUSD_PER_GIB: z.coerce.number().int().nonnegative().default(90_000),
})

export const env = sharedSchema.parse(process.env)

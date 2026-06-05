import { resolve } from "node:path"
import dotenv from "dotenv"
import { z } from "zod"

dotenv.config({ path: resolve(process.cwd(), ".env") })

export const env = z
  .object({
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
    REVIEW_WORKDIR: z.string().min(1).default(".data/reviews"),
    REVIEW_RUNS_DIR: z.string().min(1).default(".runs"),
    QDRANT_URL: z.string().min(1).optional(),
    QDRANT_API_KEY: z.string().min(1).optional(),
    QDRANT_COLLECTION: z.string().min(1).default("review_code_chunks"),
    QDRANT_INFERENCE_MODEL: z
      .string()
      .min(1)
      .default("sentence-transformers/all-minilm-l6-v2"),
    QDRANT_VECTOR_SIZE: z.coerce.number().int().positive().default(384),
  })
  .parse(process.env)

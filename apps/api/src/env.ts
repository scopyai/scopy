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
    CREEM_STARTER_PRODUCT_ID: z.string().min(1),
    // Credit granted by the one-time $1 starter, in micro-USD. Sized to roughly
    // 3-5 typical reviews; keep small since it also caps fraud exposure.
    STARTER_CREDIT_MICRO_USD: z.coerce
      .number()
      .int()
      .positive()
      .default(1_500_000),
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_SLUG: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    REVIEW_MODEL: z.string().min(1).default("z-ai/glm-5.1"),
    REVIEW_VERIFIER_MODEL: z.string().min(1).default("openai/gpt-5.4-mini"),
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
    VECTOR_WRITE_MICROUSD_PER_GIB: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(2_500_000),
    VECTOR_QUERY_MICROUSD_PER_TIB: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(7_500),
    VECTOR_NETWORK_MICROUSD_PER_GIB: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(90_000),
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_FEEDBACK_CHAT_ID: z.string().min(1).optional(),
  })
  .parse(process.env)

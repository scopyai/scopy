import { z } from "zod"
import { sharedSchema } from "./env"

export const workerEnv = sharedSchema
  .extend({
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
    REVIEW_MODEL: z.string().min(1).default("openai/gpt-5.5"),
    REVIEW_SUBAGENT_MODEL: z.string().min(1).optional(),
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
    DOCS_LIBRARIAN_MODEL: z.string().min(1).optional(),
    DOCS_RECRAWL_INTERVAL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(168),
  })
  .parse(process.env)

import { FREE_INCLUDED_REVIEW_CREDITS } from "@workspace/billing/plans"
import { z } from "zod"
import { sharedSchema } from "./env"

export const apiEnv = sharedSchema
  .extend({
    PORT: z.coerce.number().int().positive().default(3001),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    CREEM_API_KEY: z.string().min(1),
    CREEM_WEBHOOK_SECRET: z.string().min(1),
    CREEM_TEST_MODE: z
      .enum(["true", "false"])
      .transform((value) => value === "true"),
    CREEM_PREMIUM_PRODUCT_ID: z.string().min(1),
    CREEM_ULTRA_PRODUCT_ID: z.string().min(1),
    CREEM_CREDIT_TOPUP_PRODUCT_ID: z.string().min(1).optional(),
    SIGNUP_REVIEW_CREDITS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(FREE_INCLUDED_REVIEW_CREDITS),
    GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(1).optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_FEEDBACK_CHAT_ID: z.string().min(1).optional(),
  })
  .parse(process.env)

import { z } from "zod"

export const env = z
  .object({
    VITE_API_BASE_URL: z.string().default("http://localhost:3001"),
    VITE_WEB_BASE_URL: z.string().default("http://localhost:3000"),
  })
  .parse(import.meta.env)

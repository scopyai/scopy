import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

export const env = z.object({
  DATABASE_URL: z.string().min(1),
}).parse(process.env)

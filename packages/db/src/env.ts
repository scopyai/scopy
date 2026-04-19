import 'dotenv/config'
import { z } from 'zod'

export const env = z.object({
  DATABASE_URL: z.string().min(1),
}).parse(process.env)

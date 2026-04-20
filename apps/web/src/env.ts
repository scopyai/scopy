import 'dotenv'
import { z } from 'zod'

export const env = z.object({
  API_BASE_URL: z.string(),
}).parse(process.env)

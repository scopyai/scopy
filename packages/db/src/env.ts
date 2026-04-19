import { config } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const rootEnvPath = path.resolve(currentDir, '../../../.env')

config({ path: rootEnvPath, quiet: true })

export const env = z.object({
  DATABASE_URL: z.string().min(1),
}).parse(process.env)

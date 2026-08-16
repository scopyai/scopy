import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { env } from "../env"
import * as schema from "./schema"

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
})

export const db = drizzle(pool, { schema })

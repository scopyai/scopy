import { migrate } from "drizzle-orm/node-postgres/migrator"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { db, pool } from "./db/client"

const currentDir = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(currentDir, "../src/db/drizzle")

console.log("Running database migrations")

try {
  await migrate(db, { migrationsFolder })
  console.log("Database migrations completed")
} finally {
  await pool.end()
}

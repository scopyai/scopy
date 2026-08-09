import { migrate } from "drizzle-orm/node-postgres/migrator"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { db, pool } from "./db/client"

const currentDir = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(currentDir, "../src/db/drizzle")

console.log("Running database migrations")

try {
  console.log("Running Drizzle migrations")
  await migrate(db, { migrationsFolder })
  console.log("Drizzle migrations completed")
} finally {
  await pool.end()
}

import { migrate } from "drizzle-orm/node-postgres/migrator"
import { runMigrations } from "graphile-worker"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { db, pool } from "./db/client"
import { env } from "./env"

const currentDir = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(currentDir, "../src/db/drizzle")

console.log("Running database migrations")

try {
  console.log("Running Drizzle migrations")
  await migrate(db, { migrationsFolder })
  console.log("Drizzle migrations completed")

  console.log("Running Graphile Worker migrations")
  await runMigrations({ connectionString: env.DATABASE_URL })
  console.log("Graphile Worker migrations completed")
} finally {
  await pool.end()
}

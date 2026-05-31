import { runMigrations } from "graphile-worker"
import { env } from "./env"

await runMigrations({
  connectionString: env.DATABASE_URL,
})

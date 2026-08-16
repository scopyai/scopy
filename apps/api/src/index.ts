import { app } from "./app"
import { pool } from "./db/client"
import { apiEnv as env } from "./env-api"

app.listen(env.PORT, ({ hostname, port }) => {
  console.log(`🦊 Elysia is running at ${hostname}:${port}`)
})

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await app.stop()
  await pool.end()
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())

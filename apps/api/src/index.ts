import { app } from "./app"
import { pool } from "./db/client"
import { apiEnv as env } from "./env-api"
import { createHatchetClient, createHatchetJobs } from "./jobs/hatchet"
import { dispatchOutbox } from "./jobs/outbox"

const hatchet = createHatchetClient()
const jobs = createHatchetJobs(hatchet)
const stopping = new AbortController()
const outboxRun = dispatchOutbox(jobs.byName, stopping.signal)

app.listen(env.PORT, ({ hostname, port }) => {
  console.log(`🦊 Elysia is running at ${hostname}:${port}`)
})

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  stopping.abort()
  await Promise.allSettled([app.stop(), outboxRun])
  await pool.end()
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())

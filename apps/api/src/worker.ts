import { pool } from "./db/client"
import { hatchet } from "./jobs/client"
import { createHatchetJobs } from "./jobs/hatchet"

const jobs = createHatchetJobs()
const worker = await hatchet.worker("scopy-worker", {
  slots: 20,
  handleKill: false,
})
await worker.registerWorkflows(jobs.workflows)

const workerRun = worker.start()
await worker.waitUntilReady()

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await worker.stop()
}
process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())

try {
  await workerRun
  if (!shuttingDown) throw new Error("Hatchet worker stopped unexpectedly")
} finally {
  if (!shuttingDown) {
    await worker
      .stop()
      .catch((error) => console.error("Failed to stop Hatchet worker", error))
  }
  await pool.end()
}

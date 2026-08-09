import { pool } from "./db/client"
import { createHatchetClient, createHatchetJobs } from "./jobs/hatchet"

const hatchet = createHatchetClient()
const jobs = createHatchetJobs(hatchet)
const worker = await hatchet.worker("scopy-worker", {
  slots: 5,
  handleKill: false,
})
await worker.registerWorkflows(jobs.workflows)

const workerRun = worker.start()
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
    await worker.stop().catch((error) =>
      console.error("Failed to stop Hatchet worker", error)
    )
  }
  await pool.end()
}

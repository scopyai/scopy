import { run } from "graphile-worker"
import { env } from "./env"
import { taskList } from "./jobs/tasks"

const runner = await run({
  connectionString: env.DATABASE_URL,
  concurrency: 5,
  taskList,
})

await runner.promise

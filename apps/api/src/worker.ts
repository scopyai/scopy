import { run } from "graphile-worker"
import { workerEnv as env } from "./env"
import { taskList } from "./jobs/tasks"

const runner = await run({
  connectionString: env.DATABASE_URL,
  concurrency: 5,
  taskList,
  crontab: "0 4 * * * crawl_all_doc_sources",
})

await runner.promise

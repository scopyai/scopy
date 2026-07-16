import { run } from "graphile-worker"
import { workerEnv as env } from "./env"
import { taskList } from "./jobs/tasks"
import { enqueueDueDocSourceCrawls } from "./modules/docs/service"

const runner = await run({
  connectionString: env.DATABASE_URL,
  concurrency: 5,
  taskList,
  crontab: "0 4 * * * crawl_all_doc_sources",
})

await enqueueDueDocSourceCrawls({
  logger: {
    info: (message, details) => console.log(message, details ?? {}),
  },
  intervalHours: env.DOCS_RECRAWL_INTERVAL_HOURS,
}).catch((error) => {
  console.error("Startup docs sweep failed", error)
})

await runner.promise

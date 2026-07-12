import { z } from "zod"
import { protectedRoute } from "../auth"
import { queryDocsLibrarian } from "./librarian"
import { enqueueDocSourceCrawl, listDocSourcesWithState } from "./service"

const querySchema = z.object({
  library: z.string().min(1).max(200),
  question: z.string().min(1).max(2000),
})

export const docsRoutes = protectedRoute("/docs")
  .get("/sources", async () => listDocSourcesWithState())
  .post("/sources/:slug/crawl", async ({ params, status }) => {
    const enqueued = await enqueueDocSourceCrawl(params.slug)
    if (!enqueued) {
      return status(404, { error: "Unknown doc source" })
    }
    return { enqueued: true, slug: params.slug }
  })
  .post("/query", async ({ body, status }) => {
    const parsed = querySchema.safeParse(body)
    if (!parsed.success) {
      return status(400, { error: "Invalid docs query" })
    }
    return queryDocsLibrarian(parsed.data)
  })

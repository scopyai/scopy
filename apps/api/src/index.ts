import { app } from "./app"
import { apiEnv as env } from "./env"

app.listen(env.PORT, ({ hostname, port }) => {
  console.log(`🦊 Elysia is running at ${hostname}:${port}`)
})

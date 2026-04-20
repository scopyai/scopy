import { app } from './app/base'
import { env } from './env'

app.listen(env.PORT, ({ hostname, port }) => {
	console.log(`🦊 Elysia is running at ${hostname}:${port}`)
})

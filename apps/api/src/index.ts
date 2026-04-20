import { createBaseApp } from '@/app/base'
import { authRoutes } from '@/app/auth'
import { env } from '@/env'
import { healthRoutes } from '@/modules/health'
import { meRoutes } from '@/modules/me'

const app = createBaseApp()
	.use(authRoutes)
	.use(healthRoutes)
	.use(meRoutes)
	.listen(env.PORT, ({ hostname, port }) => {
		console.log(`🦊 Elysia is running at ${hostname}:${port}`)
	})

export type App = typeof app

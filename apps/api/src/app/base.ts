import { node } from '@elysia/node'
import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { env } from '../env'
import { authRoutes } from './auth'
import { githubRoutes } from '../modules/github'
import { healthRoutes } from '../modules/health'
import { meRoutes } from '../modules/me'
import { webhookRoutes } from '../modules/webhooks'
import { workspaceRoutes } from '../modules/workspaces'
	
export const app = new Elysia({
	name: 'api',
	adapter: node(),
})
	.use(cors({
		origin: env.FRONTEND_URL,
		credentials: true,
		allowedHeaders: ['Content-Type', 'Authorization'],
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	}))
	.use(authRoutes)
	.use(healthRoutes)
	.use(meRoutes)
	.use(githubRoutes)
	.use(workspaceRoutes)
	.use(webhookRoutes)

export type App = typeof app

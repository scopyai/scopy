import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import { authRoutes } from './auth'
import { healthRoutes } from '../modules/health'
import { meRoutes } from '../modules/me'
	
export const app = new Elysia({
	name: 'api',
	adapter: node(),
})
	.use(authRoutes)
	.use(healthRoutes)
	.use(meRoutes)

export type App = typeof app

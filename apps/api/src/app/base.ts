import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

export const createBaseApp = () =>
	new Elysia({
		name: 'api',
		adapter: node(),
	})
		.get('/', () => ({
			name: 'research-service-api',
			status: 'ok',
		}))

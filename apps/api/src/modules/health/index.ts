import { sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { db } from '../../db/client'

export const healthRoutes = new Elysia({ prefix: '/health' }).get(
	'/',
	async ({ status }) => {
		try {
			await db.execute(sql`select 1`)
			return { status: 'ok' as const }
		} catch {
			return status(503, { status: 'unavailable' as const })
		}
	},
)

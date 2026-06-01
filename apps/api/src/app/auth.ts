import { Elysia } from 'elysia'
import { auth } from '../auth'
import { interceptCreemScheduledCancellation } from '../billing/creem-webhook'
import { env } from '../env'
import { handleSubscriptionScheduledCancel } from '../services/billing'

const getRequestSession = (headers: Headers) => auth.api.getSession({ headers })

export const authContext = new Elysia({ name: 'auth-context' }).macro({
	auth: {
		async resolve({ request: { headers }, status }) {
			const session = await getRequestSession(headers)

			if (!session) {
				return status(401)
			}

			return {
				user: session.user,
				session: session.session,
			}
		},
	},
})

const authHandler = async (request: Request) => {
	const url = new URL(request.url)
	if (
		request.method === 'POST' &&
		url.pathname === '/api/auth/creem/webhook'
	) {
		const response = await interceptCreemScheduledCancellation(
			request,
			env.CREEM_WEBHOOK_SECRET,
			handleSubscriptionScheduledCancel,
		)
		if (response) return response
	}

	return auth.handler(request)
}

export const authRoutes = new Elysia({ name: 'auth-routes' }).mount(authHandler)

export const protectedRoute = (prefix = '') =>
	new Elysia({ prefix })
		.use(authContext)
		.guard({
			auth: true,
		})

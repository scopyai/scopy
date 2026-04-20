import { Elysia } from 'elysia'
import { auth } from '../auth'

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

export const authRoutes = new Elysia({ name: 'auth-routes' }).mount(auth.handler)

export const protectedRoute = (prefix = '') =>
	new Elysia({ prefix })
		.use(authContext)
		.guard({
			auth: true,
		})

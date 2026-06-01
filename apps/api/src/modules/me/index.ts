import { protectedRoute } from '../auth'

export const meRoutes = protectedRoute('/me')
	.get('/session', ({ session, user }) => ({
		session,
		user,
	}))
	.get('/user', ({ user }) => user)

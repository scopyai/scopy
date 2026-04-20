import { protectedRoute } from '../../app/auth'

export const meRoutes = protectedRoute('/me')
	.get('/session', ({ session, user }) => ({
		session,
		user,
	}))
	.get('/user', ({ user }) => user)

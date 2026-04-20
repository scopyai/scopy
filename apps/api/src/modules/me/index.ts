import { protectedRoutes } from '@/app/auth'

export const meRoutes = protectedRoutes('/me')
	.get('/session', ({ session, user }) => ({
		session,
		user,
	}))
	.get('/user', ({ user }) => user)

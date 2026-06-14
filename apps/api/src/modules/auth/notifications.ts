import { escapeHtml, sendTelegramMessage } from '../../lib/telegram'

type AuthUser = {
	id: string
	name: string
	email: string
}

const pendingSignupUserIds = new Set<string>()

function getAuthMethod(path?: string) {
	if (!path) return 'unknown'

	if (path.startsWith('/callback/')) {
		return path.slice('/callback/'.length) || 'oauth'
	}

	if (path === '/sign-in/email' || path.startsWith('/sign-up')) {
		return 'email'
	}

	return 'unknown'
}

export function isLoginPath(path: string) {
	return path === '/sign-in/email' || path.startsWith('/callback/')
}

export async function notifyUserSignup(user: AuthUser, path?: string) {
	pendingSignupUserIds.add(user.id)

	const message = [
		'🆕 <b>New User Sign Up</b>',
		'',
		`👤 <b>Name:</b> ${escapeHtml(user.name)}`,
		`📧 <b>Email:</b> ${escapeHtml(user.email)}`,
		`🔑 <b>Method:</b> ${escapeHtml(getAuthMethod(path))}`,
	].join('\n')

	try {
		await sendTelegramMessage(message)
	} catch (error) {
		console.error('[auth] Sign up Telegram notification failed:', error)
	}
}

export async function notifyUserLogin(user: AuthUser, path?: string) {
	if (pendingSignupUserIds.has(user.id)) {
		pendingSignupUserIds.delete(user.id)
		return
	}

	const message = [
		'🔐 <b>User Login</b>',
		'',
		`👤 <b>Name:</b> ${escapeHtml(user.name)}`,
		`📧 <b>Email:</b> ${escapeHtml(user.email)}`,
		`🔑 <b>Method:</b> ${escapeHtml(getAuthMethod(path))}`,
	].join('\n')

	try {
		await sendTelegramMessage(message)
	} catch (error) {
		console.error('[auth] Login Telegram notification failed:', error)
	}
}

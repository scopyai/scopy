import { t } from 'elysia'
import { protectedRoute } from '../auth'
import { escapeHtml, sendTelegramMessage } from '../../lib/telegram'
import { checkRateLimit } from '../../lib/rate-limit'

const feedbackRateLimit = {
	limit: 5,
	windowMs: 10 * 60 * 1000,
}

export const feedbackRoutes = protectedRoute('/feedback').post(
	'/',
	async ({ body, user, status }) => {
		const rateLimit = checkRateLimit({
			key: `feedback:${user.id}`,
			...feedbackRateLimit,
		})
		if (!rateLimit.allowed) {
			return status(429, {
				error: 'Too many feedback messages',
				retryAfterSeconds: rateLimit.retryAfterSeconds,
			})
		}

		const message = [
			'📬 <b>New Feedback</b>',
			'',
			`👤 <b>From:</b> ${escapeHtml(user.name)} (${escapeHtml(user.email)})`,
			'',
			'💬 <b>Message:</b>',
			escapeHtml(body.message),
		].join('\n')

		try {
			await sendTelegramMessage(message)
		} catch {
			return status(502, { error: 'Failed to deliver feedback' })
		}

		return { ok: true }
	},
	{
		body: t.Object({
			message: t.String({ minLength: 1, maxLength: 4000 }),
		}),
	},
)

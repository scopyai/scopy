import { t } from 'elysia'
import { protectedRoute } from '../auth'
import { env } from '../../env'

function escapeHtml(text: string) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

async function sendTelegramMessage(text: string) {
	const token = env.TELEGRAM_BOT_TOKEN
	const chatId = env.TELEGRAM_FEEDBACK_CHAT_ID

	if (!token || !chatId) {
		console.warn('[feedback] Telegram is not configured; feedback was not delivered')
		return
	}

	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: 'HTML',
		}),
	})

	if (!response.ok) {
		const body = await response.text()
		console.error('[feedback] Telegram delivery failed:', body)
		throw new Error('Failed to deliver feedback')
	}
}

export const feedbackRoutes = protectedRoute('/feedback').post(
	'/',
	async ({ body, user, status }) => {
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

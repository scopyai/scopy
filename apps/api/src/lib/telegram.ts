import { env } from '../env'

export function escapeHtml(text: string) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

export async function sendTelegramMessage(text: string) {
	const token = env.TELEGRAM_BOT_TOKEN
	const chatId = env.TELEGRAM_FEEDBACK_CHAT_ID

	if (!token || !chatId) {
		console.warn('[telegram] Telegram is not configured; message was not delivered')
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
		console.error('[telegram] Delivery failed:', body)
		throw new Error('Failed to deliver Telegram message')
	}
}

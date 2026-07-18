import { escapeHtml, sendTelegramMessage } from "../../lib/telegram"

type AuthUser = {
  id: string
  name: string
  email: string
}

const pendingSignupUserIds = new Set<string>()

function getAuthMethod(path?: string) {
  if (!path) return "unknown"
  if (path.startsWith("/callback/")) {
    return path.slice("/callback/".length) || "oauth"
  }
  if (path === "/sign-in/email" || path.startsWith("/sign-up")) return "email"
  return "unknown"
}

export function isLoginPath(path: string) {
  return path === "/sign-in/email" || path.startsWith("/callback/")
}

const notifyAuthEvent = async (
  heading: string,
  event: "Sign up" | "Login",
  user: AuthUser,
  path?: string
) => {
  const message = [
    heading,
    "",
    `👤 <b>Name:</b> ${escapeHtml(user.name)}`,
    `📧 <b>Email:</b> ${escapeHtml(user.email)}`,
    `🔑 <b>Method:</b> ${escapeHtml(getAuthMethod(path))}`,
  ].join("\n")

  try {
    await sendTelegramMessage(message)
  } catch (error) {
    console.error(`[auth] ${event} Telegram notification failed:`, error)
  }
}

export function notifyUserSignup(user: AuthUser, path?: string) {
  pendingSignupUserIds.add(user.id)
  return notifyAuthEvent("🆕 <b>New User Sign Up</b>", "Sign up", user, path)
}

export function notifyUserLogin(user: AuthUser, path?: string) {
  if (pendingSignupUserIds.delete(user.id)) return Promise.resolve()
  return notifyAuthEvent("🔐 <b>User Login</b>", "Login", user, path)
}

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { db } from './db/client'
import { env } from './env'
import { sendMagicLinkEmail } from './modules/email/email'

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.FRONTEND_URL],
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, token, url }) => {
        void token
        void url
        console.log(`Sending magic link to ${email}`)
        const res = await sendMagicLinkEmail(email, url)
        console.log(`Email sent: ${res?.id}`)
      },
    }),
  ],
})

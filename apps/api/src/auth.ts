import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { db } from './db/client'
import { env } from './env'

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, token, url }) => {
        console.log(`Sending magic link to ${email} with token ${token} and url ${url}`)
      },
    }),
  ],
})

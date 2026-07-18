import { betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "../../db/client"
import * as schema from "../../db/schema"
import { apiEnv as env } from "../../env"
import { isLoginPath, notifyUserLogin, notifyUserSignup } from "./notifications"

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.FRONTEND_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          void notifyUserSignup(
            {
              id: user.id,
              name: user.name,
              email: user.email,
            },
            ctx?.path
          )
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const newSession = ctx.context.newSession
      if (!newSession || !isLoginPath(ctx.path)) {
        return
      }

      void notifyUserLogin(
        {
          id: newSession.user.id,
          name: newSession.user.name,
          email: newSession.user.email,
        },
        ctx.path
      )
    }),
  },
})

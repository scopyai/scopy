import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { creem } from '@creem_io/better-auth'
import { db } from './db/client'
import * as schema from './db/schema'
import { env } from './env'
import {
  handleCheckoutCompleted,
  handleDisputeCreated,
  handleRefundCreated,
  handleSubscriptionCanceled,
  handleSubscriptionPaid,
  handleSubscriptionStatus,
} from './services/billing'

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.FRONTEND_URL],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [
    creem({
      apiKey: env.CREEM_API_KEY,
      webhookSecret: env.CREEM_WEBHOOK_SECRET,
      testMode: env.CREEM_TEST_MODE,
      persistSubscriptions: true,
      onCheckoutCompleted: handleCheckoutCompleted,
      onRefundCreated: handleRefundCreated,
      onDisputeCreated: handleDisputeCreated,
      onSubscriptionPaid: handleSubscriptionPaid,
      onSubscriptionActive: handleSubscriptionStatus,
      onSubscriptionPaused: handleSubscriptionStatus,
      onSubscriptionExpired: handleSubscriptionStatus,
      onSubscriptionUnpaid: handleSubscriptionStatus,
      onSubscriptionPastDue: handleSubscriptionStatus,
      onSubscriptionUpdate: handleSubscriptionStatus,
      onSubscriptionCanceled: handleSubscriptionCanceled,
    }),
  ],
})

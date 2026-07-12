export type DocsEvalCase = {
  /** Stable id, e.g. "stripe-checkout-trial". */
  id: string
  library: string
  question: string
  expect: {
    found: boolean

    citeUrlIncludes?: string[]

    answerIncludes?: string[][]
    answerExcludes?: string[]
  }
  tags?: string[]
}

export const evalCases: DocsEvalCase[] = [
  {
    id: "miss-unknown-library",
    library: "leftpad",
    question: "How do I pad a string?",
    expect: { found: false },
    tags: ["miss"],
  },
  {
    id: "miss-unknown-package-alias",
    library: "@aws-sdk/client-s3",
    question: "How do I upload an object?",
    expect: { found: false },
    tags: ["miss"],
  },
  {
    id: "miss-empty-library-name",
    library: "   ",
    question: "anything",
    expect: { found: false },
    tags: ["miss"],
  },
  {
    id: "miss-alias-resolves-stripe",
    library: "@stripe/stripe-js",
    question:
      "What is the recommended API for accepting payments in new integrations?",
    expect: {
      found: true,
      citeUrlIncludes: ["docs.stripe.com"],
      answerIncludes: [["checkout session", "checkout sessions"]],
    },
    tags: ["alias", "lookup"],
  },

  {
    id: "stripe-checkout-trial",
    library: "stripe",
    question:
      "How do I offer a free trial on a subscription via Stripe Checkout, and how do I control what happens when the trial ends without a payment method?",
    expect: {
      found: true,
      citeUrlIncludes: ["docs.stripe.com"],
      answerIncludes: [
        ["trial_period_days", "trial_end"],
        ["trial_settings", "missing_payment_method"],
      ],
    },
    tags: ["lookup"],
  },
  {
    id: "stripe-webhook-signature",
    library: "stripe",
    question:
      "How do I verify that a webhook event was actually sent by Stripe in Node.js?",
    expect: {
      found: true,
      citeUrlIncludes: ["docs.stripe.com/webhooks"],
      answerIncludes: [
        ["constructEvent", "signature"],
        ["stripe-signature", "signing secret", "endpoint secret", "whsec"],
      ],
    },
    tags: ["lookup"],
  },
  {
    id: "stripe-deprecated-charges",
    library: "stripe",
    question:
      "Should a brand-new payment integration use the Charges API? What does Stripe recommend instead?",
    expect: {
      found: true,
      citeUrlIncludes: ["docs.stripe.com"],
      answerIncludes: [
        ["checkout session", "checkout sessions", "payment intent"],
      ],
    },
    tags: ["deprecation"],
  },
  {
    id: "stripe-embedded-checkout",
    library: "stripe",
    question:
      "How do I embed Stripe Checkout directly on my own page instead of redirecting to a Stripe-hosted page?",
    expect: {
      found: true,
      citeUrlIncludes: ["docs.stripe.com"],
      answerIncludes: [["ui_mode", "embedded"]],
    },
    tags: ["lookup"],
  },
  {
    id: "stripe-trap-nonexistent-api",
    library: "stripe",
    question:
      "What are the parameters of Stripe's createInstantPayout AI fraud scoring API for the Payouts v3 beta?",
    expect: {
      found: false,
      answerExcludes: ["fraud_score"],
    },
    tags: ["trap"],
  },

  {
    id: "supabase-rls-enable",
    library: "supabase",
    question: "How do I enable row level security on a table in Supabase?",
    expect: {
      found: true,
      citeUrlIncludes: ["supabase.com"],
      answerIncludes: [
        ["row level security", "rls"],
        ["alter table", "enable row level security", "enable"],
      ],
    },
    tags: ["lookup"],
  },
  {
    id: "supabase-service-role-key",
    library: "supabase",
    question:
      "What is the service_role key, and is it safe to use in browser code?",
    expect: {
      found: true,
      citeUrlIncludes: ["supabase.com"],
      answerIncludes: [["service_role"], ["server", "never", "bypass"]],
    },
    tags: ["security"],
  },
  {
    id: "supabase-oauth-signin",
    library: "supabase",
    question:
      "Which supabase-js method starts an OAuth sign-in flow with a third-party provider like GitHub?",
    expect: {
      found: true,
      citeUrlIncludes: ["supabase.com"],
      answerIncludes: [["signInWithOAuth"]],
    },
    tags: ["lookup"],
  },
  {
    id: "supabase-trap-builtin-stripe",
    library: "supabase",
    question:
      "How do I use Supabase's built-in supabase.payments.charge() API to process credit cards?",
    expect: {
      found: false,
    },
    tags: ["trap"],
  },

  {
    id: "convex-mutation-definition",
    library: "convex",
    question:
      "How do I define a mutation function in Convex, and how do I validate its arguments?",
    expect: {
      found: true,
      citeUrlIncludes: ["convex.dev"],
      answerIncludes: [["mutation"], ["v.", "validator", "args"]],
    },
    tags: ["lookup"],
  },
  {
    id: "convex-vector-search",
    library: "convex",
    question:
      "How do I set up vector search on a table in Convex and from which function type can I run it?",
    expect: {
      found: true,
      citeUrlIncludes: ["convex.dev"],
      answerIncludes: [["vectorIndex", "vector index"], ["action"]],
    },
    tags: ["multi-page"],
  },
  {
    id: "convex-scheduled-functions",
    library: "convex",
    question: "How do I run a Convex function on a recurring schedule?",
    expect: {
      found: true,
      citeUrlIncludes: ["convex.dev"],
      answerIncludes: [["cron"]],
    },
    tags: ["lookup"],
  },

  {
    id: "vercel-env-vars",
    library: "vercel",
    question:
      "How do I add environment variables to a Vercel project and expose one to the browser in Next.js?",
    expect: {
      found: true,
      citeUrlIncludes: ["vercel.com"],
      answerIncludes: [["environment variable"], ["NEXT_PUBLIC_", "public"]],
    },
    tags: ["lookup"],
  },
  {
    id: "vercel-function-duration",
    library: "vercel",
    question: "How do I configure the maximum duration of a Vercel function?",
    expect: {
      found: true,
      citeUrlIncludes: ["vercel.com"],
      answerIncludes: [["maxDuration"]],
    },
    tags: ["lookup"],
  },
  {
    id: "conceptual-stripe-notification-reliability",
    library: "stripe",
    question:
      "Our handler assumes each notification from Stripe arrives exactly once and in the order things happened. Is that assumption safe, and how should the handler be written if not?",
    expect: {
      found: true,
      citeUrlIncludes: ["docs.stripe.com"],
      answerIncludes: [
        ["order"],
        ["duplicate", "more than once", "idempotent"],
      ],
    },
    tags: ["conceptual"],
  },
  {
    id: "conceptual-vercel-work-after-response",
    library: "vercel",
    question:
      "Is it safe for our serverless endpoint to keep doing work (like writing analytics) after it has already sent its HTTP response to the client? Is there a supported way to do that?",
    expect: {
      found: true,
      citeUrlIncludes: ["vercel.com"],
      answerIncludes: [["waitUntil", "after("]],
    },
    tags: ["conceptual"],
  },
  {
    id: "conceptual-convex-external-calls",
    library: "convex",
    question:
      "Can a Convex function that writes to the database also talk to the outside world, like calling a third-party service over the network? If not, what is the right structure?",
    expect: {
      found: true,
      citeUrlIncludes: ["convex.dev"],
      answerIncludes: [
        ["action"],
        [
          "deterministic",
          "cannot call third",
          "third-party",
          "third party",
          "external",
        ],
      ],
    },
    tags: ["conceptual"],
  },
  {
    id: "conceptual-supabase-admin-credential",
    library: "supabase",
    question:
      "Which credential lets backend code read every row of a table regardless of the access policies configured on it, and what precautions does the documentation give about that credential?",
    expect: {
      found: true,
      citeUrlIncludes: ["supabase.com"],
      answerIncludes: [
        ["service_role", "secret key", "admin"],
        ["never", "server", "expose"],
      ],
    },
    tags: ["conceptual"],
  },

  {
    id: "vercel-cron-jobs",
    library: "vercel",
    question:
      "How do I define cron jobs for my Vercel deployment and where do they run?",
    expect: {
      found: true,
      citeUrlIncludes: ["vercel.com"],
      answerIncludes: [
        ["crons", "cron"],
        ["vercel.json", "path", "schedule"],
      ],
    },
    tags: ["lookup"],
  },
]

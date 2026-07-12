export type DocSourceConfig = {
  slug: string
  name: string
  llmsTxtUrl: string
  aliases?: string[]
}

export const docSourceConfigs: DocSourceConfig[] = [
  {
    slug: "stripe",
    name: "Stripe",
    llmsTxtUrl: "https://docs.stripe.com/llms.txt",
    aliases: ["stripe-node", "@stripe/stripe-js"],
  },
  {
    slug: "vercel",
    name: "Vercel",
    llmsTxtUrl: "https://vercel.com/docs/llms.txt",
    aliases: ["@vercel/node", "vercel-cli"],
  },
  {
    slug: "convex",
    name: "Convex",
    llmsTxtUrl: "https://docs.convex.dev/llms.txt",
    aliases: ["convex-dev"],
  },
  {
    slug: "supabase",
    name: "Supabase",
    llmsTxtUrl: "https://supabase.com/llms.txt",
    aliases: ["@supabase/supabase-js"],
  },
]

export const resolveDocSourceConfig = (library: string) => {
  const normalized = library.trim().toLowerCase()
  return docSourceConfigs.find(
    (source) =>
      source.slug === normalized ||
      source.name.toLowerCase() === normalized ||
      source.aliases?.some((alias) => alias.toLowerCase() === normalized)
  )
}

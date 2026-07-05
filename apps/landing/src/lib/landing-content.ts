export const hero = {
  title: "Open-source AI code reviewer",
  subtitle:
    "Scopy is an AI-powered code reviewer that understands your repository, catches bugs and improves code quality.",
} as const

export type NamedItem = { name: string; desc: string }

export const steps: NamedItem[] = [
  {
    name: "Connect your repository",
    desc: "Install the Scopy GitHub App and choose which repositories should get automated code reviews. Setup takes under ten minutes.",
  },
  {
    name: "Open a pull request",
    desc: "Scopy reviews each new pull request automatically, building context from the diff, the affected symbols and the wider repository before it comments.",
  },
  {
    name: "Get actionable feedback",
    desc: "AI code review comments land on the exact lines that matter - flagging bugs, risky changes and rule violations so your team can fix them before merge.",
  },
]

export const features: NamedItem[] = [
  {
    name: "Full-context analysis",
    desc: "Scopy reads the full pull request to understand intent, surface area and downstream risk before it writes a word.",
  },
  {
    name: "Model-agnostic",
    desc: "Bring your own key on hosted platform, or self-host with any compatible API. No model lock-in.",
  },
  {
    name: "Right in your PR",
    desc: "Inline comments on the exact lines that matter, posted straight to your GitHub pull request.",
  },
  {
    name: "Configurable",
    desc: "Set custom linting rules and review criteria to fit your team's needs.",
  },
]

export type Faq = { q: string; a: string }

export const faqs: Faq[] = [
  {
    q: "How does Scopy AI work?",
    a: "Scopy runs reviews where your team already works. It builds context from the pull request diff, affected symbols and repository files in general, then returns actionable findings back to you.",
  },
  {
    q: "When does Scopy AI run a review?",
    a: "Reviews run automatically for enabled repositories when relevant pull request activity arrives from GitHub, such as a new pull request or a draft PR being marked ready for review. You can also request a fresh review by mentioning Scopy in a PR comment.",
  },
  {
    q: "What GitHub access does Scopy need?",
    a: "Scopy uses a GitHub App installation to receive webhook events, read repository metadata and code for selected repositories, and publish pull request feedback. GitHub controls which repositories are visible to the app, and Scopy can only review repositories granted to that installation.",
  },
  {
    q: "How does billing work?",
    a: "Billing is managed per workspace. New workspaces start with $1 of included review usage by default. Premium and Ultra are monthly plans with included review usage; reviews debit workspace credits based on actual usage during review runs. Billing changes apply to the selected workspace, not every workspace on your account.",
  },
  {
    q: "Can I use my own model API keys?",
    a: "Yes. Any workspace can switch to bring-your-own-key and add an OpenRouter or Vercel AI Gateway key. Those reviews run on your key and are billed to your provider account instead of workspace credits, and you can override the choice per repository. Keys are encrypted at rest, and self-hosted instances can use their own keys too.",
  },
  {
    q: "Can we self-host Scopy?",
    a: "Yes. Scopy AI is MIT licensed and the source code is available on GitHub. Self-hosting lets you run Scopy AI on your own infrastructure and connect your preferred model provider.",
  },
  {
    q: "Are reviews customizable?",
    a: "Yes. You can configure repositories and review criteria so Scopy focuses on the rules and risks that matter for your team, including custom linting guidance and review settings.",
  },
]

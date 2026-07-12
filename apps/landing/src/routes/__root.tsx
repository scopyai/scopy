import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import { env } from "#/env"
import appCss from "../styles.css?url"

const siteTitle =
  "Scopy AI | Open-Source AI Code Reviewer | Catch bugs and improve code quality"
const siteDescription =
  "Scopy AI is an open-source AI code reviewer. Self-host it or use hosted Scopy AI to catch bugs, enforce review rules and improve code quality."
const siteUrl = env.siteUrl
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "Scopy AI",
      url: siteUrl,
      logo: `${siteUrl}/logo-og.png`,
      sameAs: [env.githubUrl],
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: "Scopy AI",
      url: siteUrl,
      description: siteDescription,
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#software`,
      name: "Scopy AI",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: siteDescription,
      url: siteUrl,
      codeRepository: env.githubUrl,
      license: "https://opensource.org/license/mit",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        url: siteUrl,
      },
      publisher: { "@id": `${siteUrl}/#organization` },
    },
  ],
}
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: siteTitle },
      {
        name: "description",
        content: siteDescription,
      },
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#1c1c26" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Scopy AI" },
      { property: "og:title", content: siteTitle },
      { property: "og:description", content: siteDescription },
      { property: "og:url", content: siteUrl },
      { property: "og:image", content: `${siteUrl}/logo-og.png` },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: siteTitle },
      { name: "twitter:description", content: siteDescription },
      { name: "twitter:image", content: `${siteUrl}/logo-og.png` },
    ],
    links: [
      // NOTE: canonical is intentionally set per-route (see index/privacy/blog
      // routes), not here — a root canonical would append to every page and
      // point them all at the homepage.
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

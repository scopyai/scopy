import { createFileRoute, Link } from "@tanstack/react-router"
import { LandingFooter, LandingNav } from "#/components/landing-chrome"
import { env } from "#/env"
import { formatPostDate, getAllPosts } from "#/lib/blog"

const pageTitle =
  "Blog — AI code review, pull requests and code quality | Scopy"
const pageDescription =
  "Guides and practical advice on AI code review, pull request best practices and shipping higher-quality code, from the team building Scopy."
const pageUrl = `${env.siteUrl}/blog`

export const Route = createFileRoute("/blog/")({
  loader: () =>
    getAllPosts().map(({ slug, title, description, date, readingMinutes }) => ({
      slug,
      title,
      description,
      date,
      readingMinutes,
    })),
  head: () => ({
    meta: [
      { title: pageTitle },
      { name: "description", content: pageDescription },
      { property: "og:type", content: "website" },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: pageDescription },
      { property: "og:url", content: pageUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: pageTitle },
      { name: "twitter:description", content: pageDescription },
    ],
    links: [{ rel: "canonical", href: pageUrl }],
  }),
  component: BlogIndex,
})

function BlogIndex() {
  const posts = Route.useLoaderData()

  return (
    <>
      <LandingNav />
      <main className="l-blog">
        <div className="l-wrap l-blog-wrap">
          <header className="l-blog-head">
            <h1 className="l-blog-title">The Scopy blog</h1>
            <p className="l-blog-sub">
              Practical guides on AI code review, pull requests and shipping
              higher-quality code.
            </p>
          </header>

          <ul className="l-blog-list">
            {posts.map((post) => (
              <li key={post.slug} className="l-blog-card">
                <Link
                  to="/blog/$slug"
                  params={{ slug: post.slug }}
                  className="l-blog-card-link"
                >
                  <div className="l-blog-card-meta">
                    <time dateTime={post.date}>
                      {formatPostDate(post.date)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>{post.readingMinutes} min read</span>
                  </div>
                  <h2 className="l-blog-card-title">{post.title}</h2>
                  <p className="l-blog-card-desc">{post.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <LandingFooter />
    </>
  )
}

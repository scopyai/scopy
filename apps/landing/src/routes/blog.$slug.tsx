import {
  createFileRoute,
  Link,
  notFound,
  useLoaderData,
} from "@tanstack/react-router"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { LandingFooter, LandingNav } from "#/components/landing-chrome"
import { env, externalLinkProps } from "#/env"
import { formatPostDate, getPost } from "#/lib/blog"

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getPost(params.slug)
    if (!post) throw notFound()
    return post
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const url = `${env.siteUrl}/blog/${loaderData.slug}`
    const imageUrl = loaderData.cover
      ? `${env.siteUrl}${loaderData.cover}`
      : undefined
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: loaderData.title,
      description: loaderData.description,
      datePublished: loaderData.date,
      dateModified: loaderData.date,
      ...(imageUrl ? { image: imageUrl } : {}),
      author: { "@type": "Organization", name: loaderData.author },
      publisher: {
        "@type": "Organization",
        name: "Scopy AI",
        logo: { "@type": "ImageObject", url: `${env.siteUrl}/logo-og.png` },
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
    }

    return {
      meta: [
        { title: `${loaderData.title} | Scopy AI` },
        { name: "description", content: loaderData.description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: loaderData.title },
        { property: "og:description", content: loaderData.description },
        { property: "og:url", content: url },
        ...(imageUrl
          ? [
              { property: "og:image", content: imageUrl },
              { property: "og:image:alt", content: loaderData.coverAlt ?? "" },
            ]
          : []),
        { property: "article:published_time", content: loaderData.date },
        {
          name: "twitter:card",
          content: imageUrl ? "summary_large_image" : "summary",
        },
        { name: "twitter:title", content: loaderData.title },
        { name: "twitter:description", content: loaderData.description },
        ...(imageUrl
          ? [
              { name: "twitter:image", content: imageUrl },
              { name: "twitter:image:alt", content: loaderData.coverAlt ?? "" },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLd),
        },
      ],
    }
  },
  notFoundComponent: PostNotFound,
  component: BlogPost,
})

function BlogPost() {
  const post = useLoaderData({ from: "/blog/$slug" })

  async function copyCode(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const button = target.closest<HTMLButtonElement>("[data-copy-code]")
    if (!button) return

    const code = button.parentElement?.querySelector("code")?.textContent
    if (!code) return

    try {
      await navigator.clipboard.writeText(code)
      button.classList.add("is-copied")
      button.setAttribute("aria-label", "Copied to clipboard")
      window.setTimeout(() => {
        button.classList.remove("is-copied")
        button.setAttribute("aria-label", "Copy code to clipboard")
      }, 1800)
    } catch {
      button.setAttribute("aria-label", "Could not copy code")
    }
  }

  return (
    <>
      <LandingNav />
      <main className="l-blog">
        <article className="l-wrap l-post-wrap">
          <Link to="/blog" className="l-post-back">
            <ArrowLeft size={14} />
            All posts
          </Link>

          <header className="l-post-head">
            <div className="l-post-meta">
              <span className="l-post-author">{post.author}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={post.date}>{formatPostDate(post.date)}</time>
              <span aria-hidden="true">·</span>
              <span>{post.readingMinutes} min read</span>
            </div>
            <h1 className="l-post-title">{post.title}</h1>
            <p className="l-post-lede">{post.description}</p>
          </header>

          {post.cover && (
            <figure className="l-post-cover">
              <img
                src={post.cover}
                alt={post.coverAlt ?? ""}
                width={1200}
                height={630}
              />
            </figure>
          )}

          <div
            className="l-post-body"
            onClick={copyCode}
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          <footer className="l-post-foot">
            <h2 className="l-post-foot-title">
              Try Scopy AI on your next pull request
            </h2>
            <p className="l-post-foot-sub">
              Open-source AI code review that reads your whole repository.
              Self-host it or start in the cloud.
            </p>
            <div className="l-post-foot-ctas">
              <a
                href={env.githubUrl}
                className="l-btn l-btn-ghost l-btn-lg"
                {...externalLinkProps(env.githubUrl)}
              >
                View on GitHub
              </a>
              <a
                href={env.appUrl}
                className="l-btn l-btn-solid l-btn-lg"
                {...externalLinkProps(env.appUrl)}
              >
                Get started
                <ArrowRight size={16} />
              </a>
            </div>
          </footer>
        </article>
      </main>
      <LandingFooter />
    </>
  )
}

function PostNotFound() {
  return (
    <>
      <LandingNav />
      <main className="l-blog">
        <div className="l-wrap l-post-wrap">
          <h1 className="l-post-title">Post not found</h1>
          <p className="l-post-lede">
            That post doesn’t exist or may have moved.
          </p>
          <Link to="/blog" className="l-post-back">
            <ArrowLeft size={14} />
            Back to the blog
          </Link>
        </div>
      </main>
      <LandingFooter />
    </>
  )
}

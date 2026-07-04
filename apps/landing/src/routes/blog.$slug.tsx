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
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: loaderData.title,
      description: loaderData.description,
      datePublished: loaderData.date,
      dateModified: loaderData.date,
      author: { "@type": "Organization", name: loaderData.author },
      publisher: {
        "@type": "Organization",
        name: "Scopy AI",
        logo: { "@type": "ImageObject", url: `${env.siteUrl}/logo.svg` },
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
        { property: "article:published_time", content: loaderData.date },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: loaderData.title },
        { name: "twitter:description", content: loaderData.description },
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

          <div
            className="l-post-body"
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

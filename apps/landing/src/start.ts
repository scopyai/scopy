import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start"

import {
  buildLinkHeader,
  estimateTokens,
  prefersMarkdown,
} from "#/lib/agent-discovery"
import { getMarkdownForPath, hasMarkdownForPath } from "#/lib/markdown-content"

function addVary(headers: Headers, field: string): void {
  const existing = headers.get("vary")
  if (!existing) {
    headers.set("vary", field)
    return
  }
  const present = existing
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .includes(field.toLowerCase())
  if (!present) headers.set("vary", `${existing}, ${field}`)
}

const agentDiscoveryMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, next, pathname, handlerType }) => {
    const method = request.method.toUpperCase()
    const isRead = method === "GET" || method === "HEAD"

    if (
      handlerType === "router" &&
      isRead &&
      prefersMarkdown(request.headers.get("accept"))
    ) {
      const markdown = getMarkdownForPath(pathname)
      if (markdown) {
        const headers = new Headers({
          "content-type": "text/markdown; charset=utf-8",
          "x-markdown-tokens": String(estimateTokens(markdown)),
          vary: "Accept",
          link: buildLinkHeader(pathname, { representation: "markdown" }),
        })
        return new Response(method === "HEAD" ? null : markdown, {
          status: 200,
          headers,
        })
      }
    }

    const result = await next()

    if (handlerType === "router" && isRead) {
      const { response } = result
      const contentType = response.headers.get("content-type") ?? ""
      if (contentType.includes("text/html")) {
        response.headers.append(
          "link",
          buildLinkHeader(pathname, {
            representation: "html",
            hasMarkdown: hasMarkdownForPath(pathname),
          })
        )
        addVary(response.headers, "Accept")
      }
    }

    return result
  }
)

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    agentDiscoveryMiddleware,
  ],
}))

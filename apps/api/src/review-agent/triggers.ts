type CommentAuthor = {
  login?: string
  type?: string
}

export const containsBotMention = (body: string, appSlug: string) =>
  new RegExp(`(^|\\s)@${appSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
    body,
  )

export const isBotAuthoredComment = (
  author: CommentAuthor | null | undefined,
  appSlug: string,
) =>
  author?.type?.toLowerCase() === "bot" ||
  author?.login?.toLowerCase() === appSlug.toLowerCase() ||
  author?.login?.toLowerCase() === `${appSlug.toLowerCase()}[bot]`

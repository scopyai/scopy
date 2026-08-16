const internalRedirectBase = new URL("https://internal.invalid")

export function getSafeRedirect(redirect: string | undefined) {
  try {
    const redirectUrl = new URL(redirect ?? "/", internalRedirectBase)
    if (redirectUrl.origin !== internalRedirectBase.origin) return "/"

    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
  } catch {
    return "/"
  }
}

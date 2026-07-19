import { useCallback, useState } from "react"

export function useRedirectLock() {
  const [isRedirecting, setIsRedirecting] = useState(false)

  const startRedirect = useCallback(() => {
    setIsRedirecting(true)
  }, [])

  const cancelRedirect = useCallback(() => {
    setIsRedirecting(false)
  }, [])

  const redirectTo = useCallback((url: string) => {
    setIsRedirecting(true)
    window.location.href = url
  }, [])

  return { isRedirecting, startRedirect, cancelRedirect, redirectTo }
}

export function isRedirectMutationPending(mutation: {
  isPending: boolean
  isSuccess: boolean
}) {
  return mutation.isPending || mutation.isSuccess
}

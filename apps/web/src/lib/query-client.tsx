import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

export const refetchOnFocusQueryOptions = {
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const

export function ReactQueryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: true,
            retry: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

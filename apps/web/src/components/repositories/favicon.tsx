import { useState } from "react"
import { BookOpenIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

export const urlHost = (url: string) => {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, "")
  } catch {
    return null
  }
}

export function Favicon({
  url,
  className,
}: {
  url: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const host = urlHost(url)

  if (!host || failed) {
    return (
      <BookOpenIcon
        className={cn("shrink-0 text-muted-foreground", className)}
      />
    )
  }
  return (
    <img
      src={`https://${host}/favicon.ico`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-sm", className)}
    />
  )
}

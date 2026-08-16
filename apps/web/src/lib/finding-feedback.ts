import { z } from "zod"

const findingSchema = z.object({
  repo: z.string().min(1).max(500),
  file: z.string().min(1).max(1_000),
  severity: z.string().min(1).max(50),
  title: z.string().min(1).max(2_000),
  comment: z.string().max(20_000),
})

export type FindingFeedbackData = z.infer<typeof findingSchema>

const MAX_ENCODED_FINDING_LENGTH = 50_000

export function decodeFindingData(data: string): FindingFeedbackData | null {
  if (!data || data.length > MAX_ENCODED_FINDING_LENGTH) return null
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/")
    const bytes = Uint8Array.from(atob(b64), (character) =>
      character.charCodeAt(0)
    )
    const parsed = findingSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes))
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

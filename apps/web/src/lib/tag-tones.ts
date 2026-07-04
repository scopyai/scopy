import { cn } from "@workspace/ui/lib/utils"

const tagToneClassNames = [
  "border-[#5B82FF]/20 bg-[#5B82FF]/10 text-[#4268E8] dark:border-[#8EA8FF]/25 dark:bg-[#5B82FF]/15 dark:text-[#B4C4FF]",
  "border-[#6E6BFF]/20 bg-[#6E6BFF]/10 text-[#5752E6] dark:border-[#9F9DFF]/25 dark:bg-[#6E6BFF]/15 dark:text-[#C3C2FF]",
  "border-[#8B5CF6]/20 bg-[#8B5CF6]/10 text-[#6D45D8] dark:border-[#B89AFF]/25 dark:bg-[#8B5CF6]/15 dark:text-[#D3C2FF]",
  "border-[#3B9CFF]/20 bg-[#3B9CFF]/10 text-[#2176D8] dark:border-[#84C4FF]/25 dark:bg-[#3B9CFF]/15 dark:text-[#AED8FF]",
  "border-[#36B6D8]/20 bg-[#36B6D8]/10 text-[#1684A2] dark:border-[#7DD8EF]/25 dark:bg-[#36B6D8]/15 dark:text-[#A7E7F5]",
  "border-[#64748B]/20 bg-[#64748B]/10 text-[#475569] dark:border-[#94A3B8]/25 dark:bg-[#64748B]/15 dark:text-[#CBD5E1]",
] as const

const namedTagToneClassNames: Partial<Record<string, string>> = {
  payment: tagToneClassNames[0],
  refund: tagToneClassNames[4],
  dispute: tagToneClassNames[2],
  platform: tagToneClassNames[0],
  byok: tagToneClassNames[3],
  owner: tagToneClassNames[2],
  admin: tagToneClassNames[1],
  member: tagToneClassNames[5],
  active: tagToneClassNames[4],
  pending: tagToneClassNames[3],
  default: tagToneClassNames[5],
}

function hashTagValue(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function tagToneClassName(value: string, className?: string) {
  const key = value.toLowerCase()
  const namedTone = namedTagToneClassNames[key]
  const tone =
    namedTone === undefined
      ? tagToneClassNames[hashTagValue(key) % tagToneClassNames.length]
      : namedTone

  return cn("border font-normal", tone, className)
}

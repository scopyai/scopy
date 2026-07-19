export const textBytes = (text: string) => Buffer.byteLength(text, "utf8")

export const replaceEmDashes = (text: string) => text.replaceAll("—", "–")

export const truncateText = (text: string, maxBytes = 20_000) => {
  if (textBytes(text) <= maxBytes) return text
  let output = text
  while (textBytes(output) > maxBytes) {
    output = output.slice(0, Math.floor(output.length * 0.9))
  }
  return `${output}\n\n[truncated]`
}

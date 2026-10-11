export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function clip(text: string, limit: number): string {
  const line = oneLine(text)

  return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`
}

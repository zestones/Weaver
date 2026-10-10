const HEADING_START = /^##\s/

// Scanned rather than matched: a regex for the closing hashes and emphasis would backtrack on a long line.
function trimmed(text: string, drop: (char: string) => boolean): string {
  let start = 0
  let end = text.length

  while (start < end && drop(text.charAt(start))) start += 1
  while (end > start && drop(text.charAt(end - 1))) end -= 1

  return text.slice(start, end)
}

function headingOf(line: string): string | null {
  if (!HEADING_START.test(line)) return null

  const text = trimmed(line.slice(2), (char) => char === '#' || char.trim() === '')

  return text === '' ? null : text
}

export function foldHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export function headingsOf(message: string): Set<string> {
  return new Set(
    message
      .split('\n')
      .flatMap((line) => headingOf(line) ?? [])
      .map(foldHeading),
  )
}

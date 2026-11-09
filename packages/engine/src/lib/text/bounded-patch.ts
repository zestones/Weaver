export const FILE_PATCH_LIMIT = 32_768
const TOTAL_LIMIT = 200_000

export function boundedPatch(patch: string): string {
  const parts = patch.split(/(?=^diff --git )/m)
  let remaining = TOTAL_LIMIT
  const shown: string[] = []
  let omitted = 0

  for (const part of parts) {
    const bytes = Buffer.byteLength(part)
    const header = part.startsWith('diff --git ') ? part.slice(0, part.indexOf('\n') < 0 ? part.length : part.indexOf('\n')) : 'The change'
    const text =
      bytes <= FILE_PATCH_LIMIT && bytes <= remaining
        ? part
        : `${header}\nPatch omitted: ${String(bytes)} bytes (file limit ${String(FILE_PATCH_LIMIT)} bytes; total limit ${String(TOTAL_LIMIT)} bytes).`
    const size = Buffer.byteLength(text)
    if (size > remaining) omitted += bytes
    else {
      shown.push(text)
      remaining -= size + 1
    }
  }

  if (omitted > 0) shown.push(`Further patches omitted: ${String(omitted)} bytes. Read the listed changed files.`)
  return shown.join('\n')
}

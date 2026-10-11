const FENCE = '---'
const ENTRY = /^([A-Za-z][\w-]*):\s*(.*)$/
const ITEM = /^\s+-\s+(.*)$/

function unquoted(value: string): string {
  const text = value.trim()
  const quote = text.charAt(0)

  return text.length > 1 && (quote === '"' || quote === "'") && text.endsWith(quote) ? text.slice(1, -1) : text
}

// The header of a markdown file, between its two `---` lines: a value is a text, or a list written one `- item` a line
// or as `[a, b]`. No more of YAML than that is read.
export function frontMatter(text: string): Readonly<Record<string, string | readonly string[]>> {
  const lines = text.split('\n').map((line) => line.trimEnd())
  const end = lines.indexOf(FENCE, 1)
  const entries: Record<string, string | string[]> = {}
  let list: string[] | null = null

  if (lines[0] !== FENCE || end === -1) return {}

  for (const line of lines.slice(1, end)) {
    const [, key = '', value = ''] = ENTRY.exec(line) ?? []
    const item = ITEM.exec(line)?.[1]

    if (item !== undefined) list?.push(unquoted(item))
    else if (key !== '' && value === '') entries[key] = list = []
    else if (key !== '' && value.startsWith('[') && value.endsWith(']')) {
      entries[key] = value.slice(1, -1).split(',').map(unquoted)
      list = null
    } else if (key !== '') {
      entries[key] = unquoted(value)
      list = null
    }
  }

  return entries
}

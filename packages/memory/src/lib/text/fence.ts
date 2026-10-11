// A fenced block of Markdown, with a fence longer than any run of backticks in what it holds.
export function fenced(content: string, language = ''): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map(([run]) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))

  return `${fence}${language}\n${content.replace(/\n+$/, '')}\n${fence}`
}

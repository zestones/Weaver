const SPECIAL = /[.+^${}()|[\]\\]/g

// `**/` crosses any number of folders, none included; `**` anything; `*` stays within one path segment.
function toSource(glob: string): string {
  let source = ''
  let index = 0

  while (index < glob.length) {
    if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?'
      index += 3
    } else if (glob.startsWith('**', index)) {
      source += '.*'
      index += 2
    } else if (glob[index] === '*') {
      source += '[^/]*'
      index += 1
    } else if (glob[index] === '?') {
      source += '[^/]'
      index += 1
    } else {
      source += (glob[index] ?? '').replace(SPECIAL, '\\$&')
      index += 1
    }
  }

  return source
}

const globToRegExp = (glob: string): RegExp => new RegExp(`^${toSource(glob)}$`)

export function matchesAny(globs: readonly string[], path: string): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path))
}

// The folder a glob lies under: `tools/**` is under tools, `client/tsconfig*.json` under client.
export function globRoot(glob: string): string {
  const star = glob.search(/[*?]/)

  return star === -1 ? glob : glob.slice(0, Math.max(0, glob.lastIndexOf('/', star)))
}

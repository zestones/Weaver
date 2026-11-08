export function inScope(path: string, excluded: readonly string[]): boolean {
  return !excluded.some((entry) => {
    const folder = entry.replace(/^\.\//, '').replace(/\/+$/, '')

    return folder === '' || folder === '.' || path === folder || path.startsWith(`${folder}/`)
  })
}

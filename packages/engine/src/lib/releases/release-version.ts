export function compareVersions(left: string, right: string): number | null {
  const parse = (version: string): RegExpExecArray | null =>
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  const a = parse(left)
  const b = parse(right)

  if (a === null || b === null) return null

  for (const index of [1, 2, 3]) {
    const difference = Number(a[index]) - Number(b[index])

    if (difference !== 0) return difference
  }

  if (a[4] === b[4]) return 0
  if (a[4] === undefined) return 1
  if (b[4] === undefined) return -1

  const one = a[4].split('.')
  const other = b[4].split('.')

  for (let index = 0; index < Math.max(one.length, other.length); index += 1) {
    const x = one[index]
    const y = other[index]

    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y)
    if (/^\d+$/.test(x)) return -1
    if (/^\d+$/.test(y)) return 1

    return x < y ? -1 : 1
  }

  return 0
}

// A count with the word it counts, in the singular or the plural: `1 file`, `3 files`.
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`
}

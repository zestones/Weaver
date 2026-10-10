type Raw = Record<string, unknown>

const ID = /^[A-Za-z][\w.-]*$/

export class FieldReader {
  readonly problems: string[] = []

  record(value: unknown, at: string, keys: readonly string[]): Raw {
    if (value === undefined) return {}

    if (!this.isRecord(value)) {
      this.problems.push(`${at} must be an object`)

      return {}
    }

    for (const key of Object.keys(value)) if (!keys.includes(key)) this.problems.push(`${at}.${key} is not a known field`)

    return value
  }

  text(value: unknown, at: string): string | null {
    if (value === undefined) return null
    if (typeof value === 'string' && value.trim() !== '') return value

    this.problems.push(`${at} must be a non-empty string`)

    return null
  }

  strings(value: unknown, at: string): string[] | null {
    if (value === undefined) return null
    if (Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '')) return value as string[]

    this.problems.push(`${at} must be a list of non-empty strings`)

    return null
  }

  positive(value: unknown, at: string, fallback: number): number {
    if (value === undefined) return fallback
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value

    this.problems.push(`${at} must be a positive integer`)

    return fallback
  }

  entries(value: unknown, at: string): [string, unknown][] {
    if (value === undefined) return []

    if (!this.isRecord(value)) {
      this.problems.push(`${at} must be an object`)

      return []
    }

    return Object.entries(value).filter(([id]) => {
      if (ID.test(id)) return true

      this.problems.push(`${at}.${id} is not a valid identifier`)

      return false
    })
  }

  isRecord(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}

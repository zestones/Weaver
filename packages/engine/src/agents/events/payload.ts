type Raw = Record<string, unknown>

export class Payload {
  private readonly raw: Raw

  constructor(value: unknown) {
    this.raw = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {}
  }

  static parse(text: string): Payload {
    return new Payload(text.trim() === '' ? {} : JSON.parse(text))
  }

  text(key: string): string | null {
    const value = this.raw[key]

    return typeof value === 'string' ? value : null
  }

  number(key: string): number | null {
    const value = this.raw[key]

    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  flag(key: string): boolean {
    return this.raw[key] === true
  }

  record(key: string): Payload {
    return new Payload(this.raw[key])
  }

  // A runtime gives a command as one line or as its words.
  command(key: string): string {
    const value = this.raw[key]

    if (Array.isArray(value)) return value.map((part) => (typeof part === 'string' ? part : '')).join(' ')

    return typeof value === 'string' ? value : ''
  }
}

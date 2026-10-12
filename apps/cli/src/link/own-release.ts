import { readFileSync } from 'node:fs'

interface Manifest {
  readonly version: string
}

// The release this command line is. A release stamps its version in the manifest it ships; a checkout keeps the
// development default.
export class OwnRelease {
  private static readonly CHECKOUT = '0.0.0-dev'

  readonly version: string

  constructor(version?: string) {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Manifest

    this.version = version ?? manifest.version
  }

  get isCheckout(): boolean {
    return this.version === OwnRelease.CHECKOUT
  }

  // The name its release carries.
  get tag(): string {
    return `v${this.version}`
  }

  // Whether a release, by its tag, came after this one. A tag that is not three numbers is taken as later when it
  // differs: the owner asked for what is published.
  isOlderThan(tag: string): boolean {
    const mine = this.numbers(this.tag)
    const theirs = this.numbers(tag)

    if (mine === null || theirs === null) return tag !== this.tag

    const [differing = 0] = theirs.map((number, index) => number - (mine[index] ?? 0)).filter((difference) => difference !== 0)

    return differing > 0
  }

  private numbers(tag: string): number[] | null {
    const parts = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)

    return parts === null ? null : parts.slice(1).map(Number)
  }
}

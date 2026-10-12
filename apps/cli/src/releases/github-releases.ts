import { writeFileSync } from 'node:fs'
import type { PublishedRelease, ReleaseSource } from './release-source.ts'

interface GithubRelease {
  readonly tag_name: string
  readonly assets: readonly { readonly name: string; readonly url: string }[]
}

const API = 'https://api.github.com'

// The releases of the repository on GitHub. A token, when the environment gives one, is sent with each request: a
// private repository answers nothing without it.
export class GithubReleases implements ReleaseSource {
  private readonly repository: string
  private readonly token: string | null

  constructor(repository = 'zestones/Weaver', token: string | null = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null) {
    this.repository = repository
    this.token = token
  }

  async latest(): Promise<PublishedRelease> {
    const response = await this.ask(`${API}/repos/${this.repository}/releases/latest`, 'application/vnd.github+json')
    const release = (await response.json()) as GithubRelease

    return { tag: release.tag_name, assets: new Map(release.assets.map((asset) => [asset.name, asset.url])) }
  }

  async fetch(release: PublishedRelease, name: string, to: string): Promise<void> {
    const url = release.assets.get(name)

    if (url === undefined) throw new Error(`the release ${release.tag} has no ${name}`)

    const response = await this.ask(url, 'application/octet-stream')

    writeFileSync(to, Buffer.from(await response.arrayBuffer()))
  }

  private async ask(url: string, accept: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'weaver',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token === null ? {} : { Authorization: `Bearer ${this.token}` }),
      },
    })

    if (response.ok) return response

    const hint = response.status === 404 && this.token === null ? ' A private repository needs a token in GH_TOKEN.' : ''

    throw new Error(`the releases of ${this.repository} could not be read: GitHub answered ${String(response.status)}.${hint}`)
  }
}

export interface PublishedRelease {
  readonly tag: string
  // What its publisher wrote of it, as Markdown; empty when nothing was written.
  readonly notes: string
  // Each file the release carries, by its name, with where it is fetched from.
  readonly assets: ReadonlyMap<string, string>
}

// Where the releases of Weaver are published.
export interface ReleaseSource {
  latest(): Promise<PublishedRelease>

  // Writes one file of a release where it is asked.
  fetch(release: PublishedRelease, name: string, to: string): Promise<void>
}

const NEAR = 2

// The command a mistyped word was probably meant to be: the one a couple of keystrokes away, when there is one.
export class NearestCommand {
  readonly name: string | null

  constructor(word: string, names: readonly string[]) {
    const [nearest] = names
      .map((name) => ({ name, distance: this.distance(word, name) }))
      .filter(({ distance }) => distance <= NEAR)
      .sort((one, other) => one.distance - other.distance)

    this.name = nearest?.name ?? null
  }

  // The number of letters to add, remove or replace to turn one word into the other.
  private distance(from: string, to: string): number {
    let row = Array.from({ length: to.length + 1 }, (_, index) => index)

    for (let i = 1; i <= from.length; i += 1) {
      const next = [i]

      for (let j = 1; j <= to.length; j += 1) {
        const replaced = (row[j - 1] ?? 0) + (from[i - 1] === to[j - 1] ? 0 : 1)

        next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, replaced))
      }

      row = next
    }

    return row[to.length] ?? 0
  }
}

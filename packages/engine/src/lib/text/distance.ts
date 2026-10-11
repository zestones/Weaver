// How many letters must be added, removed or replaced to turn one word into the other.
export function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]

    for (let column = 1; column <= right.length; column += 1) {
      const replaced = (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)

      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, replaced))
    }

    previous = current
  }

  return previous[right.length] ?? 0
}

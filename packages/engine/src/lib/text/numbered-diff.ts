const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const FILE_HEADER = /^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity|rename |Binary files )/
const WIDTH = 5

// A unified diff whose lines each carry their number in the new file: a reader that has to count from the hunk headers
// lands a few lines off.
export function numberedDiff(diff: string): string {
  const lines: string[] = []
  let number = 0

  for (const line of diff.split('\n')) {
    const hunk = HUNK.exec(line)
    const at = String(number).padStart(WIDTH)

    if (hunk !== null) {
      lines.push(line)
      number = Number(hunk[1])
    } else if (FILE_HEADER.test(line)) lines.push(line)
    else if (line.startsWith('-')) lines.push(`${' '.repeat(WIDTH)} - ${line.slice(1)}`)
    else if (line === '' || line.startsWith('\\')) lines.push(line)
    else {
      lines.push(line.startsWith('+') ? `${at} + ${line.slice(1)}` : `${at}   ${line.slice(1)}`)
      number += 1
    }
  }

  return lines.join('\n').trim()
}

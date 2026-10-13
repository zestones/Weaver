import type { Atom } from './atom.ts'

const STYLES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

// Atoms laid on lines no wider than a width. The first line starts with one prefix and the others with another, so
// that the text of a list item stays under its first word. An atom wider than the line has a line of its own.
export class WrappedLines {
  private readonly width: number

  constructor(width: number) {
    this.width = width
  }

  of(atoms: readonly Atom[], first = '', rest = first): string[] {
    const lines: string[] = []
    let line = first
    let used = this.visible(first)
    let empty = true

    for (const atom of atoms) {
      if (!empty && (atom.startsLine === true || used + 1 + atom.width > this.width)) {
        lines.push(line)
        line = rest
        used = this.visible(rest)
        empty = true
      }

      line = `${line}${empty ? '' : ' '}${atom.text}`
      used += atom.width + (empty ? 0 : 1)
      empty = false
    }

    return [...lines, line]
  }

  // How wide a text reads, whatever styles it carries.
  visible(text: string): number {
    return text.replace(STYLES, '').length
  }
}

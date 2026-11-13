import { readSync } from 'node:fs'

export class Confirmation {
  get available(): boolean {
    return process.stdin.isTTY === true
  }

  ask(): boolean {
    const byte = Buffer.alloc(1)
    let answer = ''
    while (readSync(0, byte, 0, 1, null) > 0) {
      const character = byte.toString()
      if (character === '\n') break
      answer += character
    }
    return /^(?:y|yes)$/i.test(answer.trim())
  }
}

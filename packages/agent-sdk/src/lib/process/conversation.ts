import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { signalGroup } from './process.ts'

export interface ConversationOptions {
  readonly cwd: string
  readonly timeoutMs: number
}

// What a line of the process leads to: lines to send back, or the answer that ends the conversation.
export type Heard<Answer> = { readonly say: readonly string[] } | { readonly answer: Answer } | null

// A process spoken to line by line, from a first line until `hear` gives an answer. Null when the process does not
// start, ends before it answered, or stays silent past the deadline. The process is stopped once the answer is known.
export function converse<Answer>(
  command: string,
  args: readonly string[],
  options: ConversationOptions,
  opening: string,
  hear: (line: string) => Heard<Answer>,
): Promise<Answer | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, detached: true, stdio: ['pipe', 'pipe', 'ignore'] })
    const lines = createInterface({ input: child.stdout })
    let over = false

    const end = (answer: Answer | null): void => {
      if (over) return

      over = true
      clearTimeout(timer)
      lines.close()
      child.stdin.destroy()
      child.stdout.destroy()
      signalGroup(child.pid, 'SIGTERM')
      child.unref()
      resolve(answer)
    }
    const timer = setTimeout(() => {
      end(null)
    }, options.timeoutMs)

    // A process that ends before it has read everything closes the pipe: its end says what happened.
    child.stdin.on('error', () => undefined)
    child.on('error', () => {
      end(null)
    })
    child.on('close', () => {
      end(null)
    })
    lines.on('line', (line) => {
      const heard = over ? null : hear(line)

      if (heard === null) return
      if ('answer' in heard) end(heard.answer)
      else for (const reply of heard.say) child.stdin.write(`${reply}\n`)
    })
    child.stdin.write(`${opening}\n`)
  })
}

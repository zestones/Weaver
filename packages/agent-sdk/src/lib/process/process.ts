import { spawn, spawnSync } from 'node:child_process'

export interface ProcessResult {
  // 124 when the deadline killed the process, as timeout(1) reports it.
  readonly code: number
  readonly output: string
  readonly stdout: string
  readonly ms: number
}

export interface ProcessOptions {
  readonly cwd: string
  readonly timeoutMs: number
  readonly env?: NodeJS.ProcessEnv
  readonly outputLimit?: number
  // What the command reads on its standard input; without it, it reads nothing.
  readonly input?: string
}

export const TIMED_OUT = 124
const OUTPUT_LIMIT = 2 * 1024 * 1024
const KILL_GRACE_MS = 2000

function collector(limit: number): { collect: (chunk: Buffer) => void; text: () => string } {
  const chunks: Buffer[] = []
  let size = 0

  return {
    collect: (chunk) => {
      if (size < limit) chunks.push(chunk.subarray(0, limit - size))
      size += chunk.length
    },
    text: () => Buffer.concat(chunks).toString('utf8') + (size > limit ? `\n[weaver] output cut at ${String(limit)} bytes` : ''),
  }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return

  try {
    process.kill(-pid, signal)
  } catch {
    // The group is already gone.
  }
}

// The command runs in its own process group, so that a deadline kills its workers too (vitest, tsc, vite).
export function runProcess(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
  const limit = options.outputLimit ?? OUTPUT_LIMIT
  const stdout = collector(limit)
  const combined = collector(limit)

  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env), FORCE_COLOR: '0', NO_COLOR: '1' },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let killed = false
    let error: string | null = null

    // A command that ends before it has read everything closes the pipe: its exit says what happened.
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')

    const timer = setTimeout(() => {
      killed = true
      signalGroup(child.pid, 'SIGTERM')
      setTimeout(() => {
        signalGroup(child.pid, 'SIGKILL')
      }, KILL_GRACE_MS).unref()
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.collect(chunk)
      combined.collect(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      combined.collect(chunk)
    })
    child.on('error', (failure) => {
      error = failure.message
    })
    child.on('close', (code) => {
      clearTimeout(timer)

      const output =
        combined.text() +
        (error === null ? '' : `\n[weaver] ${error}`) +
        (killed ? `\n[weaver] stopped after ${String(options.timeoutMs)} ms` : '')

      resolve({ code: killed ? TIMED_OUT : (code ?? 1), output, stdout: stdout.text(), ms: Date.now() - started })
    })
  })
}

export function starts(command: string): boolean {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0
}

import { basename } from 'node:path'
import { argText, type ShellWord } from './words.ts'

export interface Assignment {
  readonly name: string
  readonly value: ShellWord
}

export interface ShellRedirect {
  readonly operator: string
  // The file written or read; null for a heredoc, a here-string or a descriptor copy such as 2>&1.
  readonly target: ShellWord | null
  readonly heredoc: string | null
}

export interface ShellCommand {
  // The name the command runs by, without its directory; '' for a bare assignment or a name an expansion decides.
  readonly program: string
  readonly executable: string | null
  readonly words: readonly ShellWord[]
  readonly args: readonly string[]
  readonly assigns: readonly Assignment[]
  readonly redirects: readonly ShellRedirect[]
  // Where it runs, followed through literal `cd`s; null once the directory is unknown.
  readonly cwd: string | null
  readonly envFlags: readonly string[]
  // For a command find runs on its results, the paths find searched.
  readonly findRoots: readonly string[] | null
  readonly upstream: readonly ShellCommand[]
}

export type CommandBase = Pick<ShellCommand, 'assigns' | 'redirects' | 'cwd' | 'envFlags' | 'findRoots' | 'upstream'>

export const EMPTY_BASE: CommandBase = { assigns: [], redirects: [], cwd: null, envFlags: [], findRoots: null, upstream: [] }

export function commandOf(argv: readonly ShellWord[], base: CommandBase): ShellCommand {
  const [name, ...words] = argv
  const program = name?.value === undefined || name.value === null ? '' : basename(name.value)

  return { ...base, program, executable: name?.value ?? null, words, args: words.map(argText) }
}

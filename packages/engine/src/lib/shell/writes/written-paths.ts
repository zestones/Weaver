import { isAbsolute, resolve } from 'node:path'
import type { ShellCommand } from '../syntax/command.ts'
import { argText, type ShellWord } from '../syntax/words.ts'

const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])
const SILENT = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/

interface SwitchSyntax {
  // Letters whose value, if any, is the rest of their word: `-i.bak`, `-MList::Util=sum`.
  readonly attached: ReadonlySet<string>
  // Letters that take the next word when nothing follows them in theirs: `-e 'code'`.
  readonly nextWord: ReadonlySet<string>
}

interface ShortSwitches {
  readonly all: ReadonlySet<string>
  // perl and ruby stop reading switches at their script or first file; sed reads them anywhere.
  readonly beforeOperands: ReadonlySet<string>
}

const SED_SYNTAX: SwitchSyntax = { attached: new Set(['i']), nextWord: new Set(['e', 'f', 'l']) }
const PERL_SYNTAX: SwitchSyntax = { attached: new Set(Array.from('iMmIFxdDCVl')), nextWord: new Set(['e', 'E', 'r']) }

interface Written {
  readonly paths: readonly (string | null)[]
  readonly how: string
  readonly creates: boolean
  readonly removes: boolean
}

type Files = readonly (string | null)[]
type Writer = (command: ShellCommand, files: Files) => Written[]

// The words that name files, in order; a word an expansion decides stays in place as null, so that positions hold.
function positional(command: ShellCommand): (string | null)[] {
  return command.words
    .filter((word) => !argText(word).startsWith('-'))
    .flatMap((word: ShellWord): (string | null)[] =>
      word.value === '{}' && command.findRoots !== null ? [...command.findRoots] : [word.value],
    )
}

// A command find runs on its results may reach every file under the roots it searched: they count as removed.
const reachesRoots = (command: ShellCommand): boolean => command.findRoots !== null

const creating: Writer = (command, files) => [{ paths: files, how: command.program, creates: true, removes: reachesRoots(command) }]

const removing: Writer = (command, files) => [{ paths: files, how: command.program, creates: false, removes: true }]

const changingMode: Writer = (command, files) => [
  { paths: files.slice(1), how: command.program, creates: false, removes: reachesRoots(command) },
]

const copying: Writer = (command, files) => {
  const target = command.args.findIndex((arg) => arg === '-t' || arg === '--target-directory')
  const lastFile = files.length > 1 ? files.slice(-1) : []
  const destination = target === -1 ? lastFile : [command.words[target + 1]?.value ?? null]

  return [{ paths: destination, how: command.program, creates: true, removes: reachesRoots(command) }]
}

const moving: Writer = (command, files) => [
  { paths: files.slice(0, -1), how: 'mv', creates: false, removes: true },
  { paths: files.slice(-1), how: 'mv', creates: true, removes: reachesRoots(command) },
]

const ddWriting: Writer = (command) => {
  const outputs = command.args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice('of='.length))

  return [{ paths: outputs, how: 'dd of=', creates: true, removes: reachesRoots(command) }]
}

function lettersOf(word: string, syntax: SwitchSyntax): { letters: string[]; takesNext: boolean } {
  const letters = Array.from(word.slice(1).replace(/\d/g, ''))
  const end = letters.findIndex((letter) => syntax.attached.has(letter) || syntax.nextWord.has(letter))

  if (end === -1) return { letters, takesNext: false }

  return { letters: letters.slice(0, end + 1), takesNext: end === letters.length - 1 && syntax.nextWord.has(letters[end] ?? '') }
}

function shortSwitches(args: readonly string[], syntax: SwitchSyntax): ShortSwitches {
  const all = new Set<string>()
  const beforeOperands = new Set<string>()
  let operandSeen = false
  let index = 0

  while (index < args.length && args[index] !== '--') {
    const arg = args[index] ?? ''
    const { letters, takesNext } = /^-[^-]/.test(arg) ? lettersOf(arg, syntax) : { letters: [], takesNext: false }

    operandSeen ||= !arg.startsWith('-') || arg === '-'
    for (const letter of letters) {
      all.add(letter)
      if (!operandSeen) beforeOperands.add(letter)
    }

    index += takesNext ? 2 : 1
  }

  return { all, beforeOperands }
}

const sedInPlace: Writer = (command, files) => {
  const inPlace = command.args.some((arg) => arg.startsWith('--in-place')) || shortSwitches(command.args, SED_SYNTAX).all.has('i')

  return inPlace ? [{ paths: files.slice(1), how: 'sed -i', creates: false, removes: reachesRoots(command) }] : []
}

// perl -i -e 'script' file: the first word is the script; perl -i script.pl file: the script is a file of its own.
const perlInPlace: Writer = (command, files) => {
  const { args, program } = command
  const letters = shortSwitches(args, PERL_SYNTAX).beforeOperands
  const paths = files.slice(letters.has('e') || letters.has('E') ? 1 : 0)

  return letters.has('i') ? [{ paths, how: `${program} -i`, creates: false, removes: reachesRoots(command) }] : []
}

const WRITERS: Readonly<Record<string, Writer>> = {
  tee: creating,
  touch: creating,
  mkdir: creating,
  cp: copying,
  install: copying,
  ln: copying,
  rsync: copying,
  mv: moving,
  rm: removing,
  rmdir: removing,
  unlink: removing,
  shred: removing,
  truncate: removing,
  chmod: changingMode,
  chown: changingMode,
  dd: ddWriting,
  sed: sedInPlace,
  perl: perlInPlace,
  ruby: perlInPlace,
}

function redirected(command: ShellCommand): Written[] {
  return command.redirects
    .filter((redirect) => WRITE_REDIRECTS.has(redirect.operator) && redirect.target !== null)
    .map((redirect) => ({
      paths: [redirect.target?.value ?? null],
      how: `The redirection ${redirect.operator} ${redirect.target?.text ?? ''}`,
      creates: true,
      removes: false,
    }))
}

// perl and ruby write in place what they name, and may also run a script that writes anything.
const ALSO_SCRIPTS = new Set(['perl', 'ruby'])

// Whether every file the command writes is named in its words.
export const namesItsWrites = (command: ShellCommand): boolean => command.program in WRITERS && !ALSO_SCRIPTS.has(command.program)

export interface WrittenPaths {
  readonly paths: readonly string[]
  readonly removed: readonly string[]
  readonly unplaced: boolean
}

export function writtenPaths(command: ShellCommand, root: string): WrittenPaths {
  const writes = [...redirected(command), ...(WRITERS[command.program]?.(command, positional(command)) ?? [])]
  const written = writes.flatMap((each) => each.paths)
  const placed = (paths: Files): string[] =>
    paths
      .filter((path) => path !== null && (command.cwd !== null || isAbsolute(path)) && !SILENT.test(path))
      .map((path) => resolve(command.cwd ?? root, path ?? ''))

  return {
    paths: placed(written),
    removed: placed(writes.filter((each) => each.removes).flatMap((each) => each.paths)),
    unplaced: written.some((path) => path === null || (command.cwd === null && !isAbsolute(path))),
  }
}

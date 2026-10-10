import { commandOf, type Assignment, type ShellCommand } from './command.ts'
import { argText, literalWord, type ShellWord } from './words.ts'

export type Peeled = { readonly command: ShellCommand } | { readonly script: string } | null

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const PASS_THROUGH = new Set(['builtin', 'nohup', 'chronic', 'unbuffer', 'noglob', 'doas'])
const OPTIONS_WITH_VALUE: Readonly<Record<string, readonly string[]>> = {
  exec: ['-a'],
  nice: ['-n'],
  ionice: ['-c', '-n'],
  stdbuf: [],
  setsid: [],
  time: [],
  sudo: ['-u', '-g', '-C', '-D'],
  watch: ['-n', '--interval'],
  xargs: ['-n', '-I', '-i', '-P', '-L', '-d', '-E', '-s', '-a', '--max-args', '--replace', '--max-procs', '--delimiter'],
}

const TIMEOUT_OPTIONS = ['-s', '--signal', '-k', '--kill-after']
const FLOCK_OPTIONS = ['-w', '--timeout', '-E']
const RUNNER_OPTIONS = ['-p', '--package', '-c', '--call']

const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir'])
// The shell has already unquoted `\;` into `;`.
const FIND_END = new Set([';', '+'])

const ASSIGNMENT = /^[A-Za-z_]\w*=/
const SHORT_FLAGS = /^-[a-zA-Z]+$/

function optionsEnd(args: readonly string[], withValue: readonly string[]): number {
  let index = 0

  while (index < args.length && (args[index] ?? '').startsWith('-')) {
    if (args[index] === '--') return index + 1

    index += withValue.includes(args[index] ?? '') ? 2 : 1
  }

  return index
}

const afterOptions = (words: readonly ShellWord[], withValue: readonly string[]): readonly ShellWord[] =>
  words.slice(optionsEnd(words.map(argText), withValue))

const run = (outer: ShellCommand, argv: readonly ShellWord[], extra: Partial<ShellCommand> = {}): Peeled =>
  argv.length === 0 ? null : { command: { ...commandOf(argv, outer), ...extra } }

function assignmentOf(word: ShellWord): Assignment {
  const text = argText(word)
  const at = text.indexOf('=')

  return { name: text.slice(0, at), value: { ...word, value: word.value === null ? null : text.slice(at + 1) } }
}

function peelEnv(outer: ShellCommand): Peeled {
  const envFlags = [...outer.envFlags]
  const assigns = [...outer.assigns]
  const { args, words } = outer
  let index = 0

  for (; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    const next = args[index + 1] ?? ''

    if (arg === '-S' || arg === '--split-string') return { script: args.slice(index + 1).join(' ') }
    if (arg === '-u' || arg === '--unset' || arg === '-C' || arg === '--chdir') index += 1
    if (arg === '-u' || arg === '--unset') envFlags.push(`unset:${next}`)
    else if (arg.startsWith('--unset=')) envFlags.push(`unset:${arg.slice('--unset='.length)}`)
    else if (arg === '-i' || arg === '--ignore-environment' || arg === '-') envFlags.push('clear')
    else if (ASSIGNMENT.test(arg)) assigns.push(assignmentOf(words[index] ?? literalWord(arg)))
    else if (!arg.startsWith('-') || arg === '--') break
  }

  return run(outer, words.slice(args[index] === '--' ? index + 1 : index), { envFlags, assigns })
}

function searchedRoots(args: readonly string[]): string[] {
  const firstTest = args.findIndex((arg) => arg.startsWith('-') || arg === '(' || arg === '!')
  const roots = (firstTest === -1 ? args : args.slice(0, firstTest)).filter((arg) => !['-H', '-L', '-P'].includes(arg))

  return roots.length > 0 ? roots : ['.']
}

function peelFind(outer: ShellCommand): Peeled {
  const { args } = outer
  const findRoots = searchedRoots(args)
  const exec = args.findIndex((arg) => FIND_EXEC.has(arg))
  const end = args.findIndex((arg, index) => index > exec && FIND_END.has(arg))

  if (args.includes('-delete')) return run(outer, [literalWord('rm'), ...findRoots.map(literalWord)], { findRoots })
  if (exec === -1) return null

  return run(outer, outer.words.slice(exec + 1, end === -1 ? undefined : end), { findRoots })
}

function peelShell(outer: ShellCommand): Peeled {
  const flag = outer.args.findIndex((arg) => SHORT_FLAGS.test(arg) && arg.includes('c'))
  const heredoc = outer.redirects.find((redirect) => redirect.heredoc !== null)?.heredoc ?? null

  if (flag !== -1) return { script: outer.args[flag + 1] ?? '' }
  if (heredoc !== null && outer.args.every((arg) => arg.startsWith('-'))) return { script: heredoc }

  return null
}

function peelRunner(outer: ShellCommand): Peeled {
  const viaManager = ['npm', 'pnpm', 'yarn'].includes(outer.program) && ['exec', 'dlx', 'x'].includes(outer.args[0] ?? '')

  if (!viaManager && outer.program !== 'npx' && outer.program !== 'bunx') return null

  return run(outer, afterOptions(viaManager ? outer.words.slice(1) : outer.words, RUNNER_OPTIONS))
}

function peelCommand(outer: ShellCommand): Peeled {
  const [first] = outer.args

  if (first === '-v' || first === '-V') return null

  return run(outer, first === '-p' ? outer.words.slice(1) : outer.words)
}

function peelFlock(outer: ShellCommand): Peeled {
  const flag = outer.args.findIndex((arg) => arg === '-c' || arg === '--command')

  if (flag !== -1) return { script: outer.args[flag + 1] ?? '' }

  return run(outer, afterOptions(outer.words, FLOCK_OPTIONS).slice(1))
}

export function peel(outer: ShellCommand): Peeled {
  const { program } = outer

  if (program === 'env') return peelEnv(outer)
  if (program === 'command') return peelCommand(outer)
  if (program === 'eval') return { script: outer.args.join(' ') }
  if (program === 'find') return peelFind(outer)
  if (program === 'flock') return peelFlock(outer)
  if (program === 'timeout') return run(outer, afterOptions(outer.words, TIMEOUT_OPTIONS).slice(1))
  if (PASS_THROUGH.has(program)) return run(outer, outer.words)
  if (program in OPTIONS_WITH_VALUE) return run(outer, afterOptions(outer.words, OPTIONS_WITH_VALUE[program] ?? []))
  if (SHELLS.has(program)) return peelShell(outer)

  return peelRunner(outer)
}

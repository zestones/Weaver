import type { ShellCommand } from '../syntax/command.ts'
import { analyzeShell } from '../syntax/parse.ts'
import { isGenerator, isReader, NO_HINTS, type CommandHints } from './hints.ts'
import { pythonEntry } from './python.ts'

// sed, awk, env and command are left out: a sed `w`, an awk redirect or the program env runs may write anywhere.
const READERS = new Set([
  ...'ls cat head tail less more nl column wc sort uniq cut tr diff cmp jq yq echo printf'.split(' '),
  ...'grep egrep fgrep rg fd find tree stat file du df realpath readlink basename dirname pwd which type'.split(' '),
  ...'date true false test [ sleep ps pgrep lsof ss id whoami uname printenv cd pushd popd hash'.split(' '),
])
const WRITING_FLAGS: Readonly<Record<string, RegExp>> = {
  sort: /^(-[a-zA-Z]*o|--output)/,
  tree: /^(-[a-zA-Z]*o|--output)/,
  yq: /^(-[a-zA-Z]*i|--inplace)/,
  find: /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/,
}

const GIT_READS = new Set(
  [
    'status diff log show blame annotate grep shortlog describe ls-files ls-tree ls-remote cat-file rev-parse rev-list merge-base',
    'name-rev for-each-ref show-ref show-branch var version help check-ignore check-attr check-ref-format diff-tree diff-files',
    'diff-index count-objects verify-commit verify-tag range-diff whatchanged cherry fsck patch-id column',
  ]
    .join(' ')
    .split(' '),
)
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path'])

const TOOLS = new Set([
  'tsc',
  'vitest',
  'eslint',
  'prettier',
  'jscpd',
  'depcruise',
  'knip',
  'playwright',
  'basedpyright',
  'squawk',
  'lint-imports',
])
const TOOL_WRITES = /^(-u|--update|--fix|--write|--update-snapshots|-w)$/

const NPM_READS = /^(test|t|ls|view|outdated|audit|explain|why|run|run-script)$/
const NPM_SCRIPT_READS = /^(test|lint|typecheck|check|build|e2e)(:[\w:-]+)?$|:check$/
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])
const SILENT_TARGET = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/

const writesThroughRedirect = (command: ShellCommand): boolean =>
  command.redirects.some((redirect) => WRITE_REDIRECTS.has(redirect.operator) && !SILENT_TARGET.test(redirect.target?.value ?? ''))

function gitSubcommand(args: readonly string[]): string | undefined {
  let index = 0

  while (index < args.length && (args[index] ?? '').startsWith('-')) index += GIT_OPTIONS_WITH_VALUE.has(args[index] ?? '') ? 2 : 1

  return args[index]
}

// What npm passes on after `--` goes to the tool the script runs: `npm test -- -u` updates snapshots.
function npmReads(args: readonly string[]): boolean {
  const passed = args.includes('--') ? args.slice(args.indexOf('--') + 1) : []
  const [sub, script] = args.filter((arg) => !arg.startsWith('-'))

  if (sub === undefined || !NPM_READS.test(sub) || passed.some((arg) => TOOL_WRITES.test(arg))) return false

  return sub !== 'run' && sub !== 'run-script' ? true : script !== undefined && NPM_SCRIPT_READS.test(script)
}

function toolReads(command: ShellCommand): boolean | null {
  const { program, args } = command
  const entry = pythonEntry(command)
  const module = entry?.kind === 'module' ? entry.value : program
  const toolArgs = entry?.kind === 'module' ? entry.args : args

  if (module === 'ruff') {
    return toolArgs.includes('format')
      ? toolArgs.includes('--check') || toolArgs.includes('--diff')
      : toolArgs.includes('--no-fix') && !toolArgs.some((arg) => arg.startsWith('--fix'))
  }

  if (module === 'sqlfluff') return toolArgs[0] === 'lint' || toolArgs[0] === 'parse'
  if (module === 'pytest') return !toolArgs.some((arg) => /^(--update|--snapshot-update|--update-snapshots)$/.test(arg))
  if (TOOLS.has(module)) return !toolArgs.some((arg) => TOOL_WRITES.test(arg))

  return null
}

function commandReads(command: ShellCommand, hints: CommandHints): boolean {
  const { program, args } = command
  const writing = WRITING_FLAGS[program]

  if (writesThroughRedirect(command) || isGenerator(command, hints)) return false
  if (isReader(command, hints)) return true
  if (program === 'git') return GIT_READS.has(gitSubcommand(args) ?? '') && !args.some((arg) => arg.startsWith('--output'))
  if (program === 'npm') return npmReads(args)
  const tool = toolReads(command)

  if (tool !== null) return tool

  return READERS.has(program) && (writing === undefined || !args.some((arg) => writing.test(arg)))
}

export function readsOnly(line: string, cwd: string, hints: CommandHints = NO_HINTS): boolean {
  const analysis = analyzeShell(line, cwd)
  const runners = new Set(['npx', 'bunx'])

  return analysis.complete && analysis.commands.every((command) => runners.has(command.program) || commandReads(command, hints))
}

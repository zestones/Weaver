import { relative } from 'node:path'
import type { ShellCommand } from '../syntax/command.ts'
import { analyzeShell } from '../syntax/parse.ts'
import { isGenerator, NO_HINTS, type CommandHints } from './hints.ts'
import { pythonEntry } from './python.ts'
import { readsOnly } from './read-only.ts'
import { writtenPaths } from './written-paths.ts'

// What a shell command line writes, as far as its words say: anything that changes while it runs (`all`), only the
// paths it names, or nothing that can be told from it (`none`).
export type WriteScope = 'all' | 'none' | readonly string[]

const INTERPRETER = /^(python3?(\.\d+)?|node|perl|ruby|deno|bun)$/
const INLINE_FLAGS = new Set(['-c', '-e', '--eval', '-p', '--print', '-E'])
const WRITES_IN_CODE = [
  'writeFile',
  'appendFile',
  'write_text',
  'write_bytes',
  'unlink',
  'rmSync',
  'copyFile',
  'renameSync',
  'shutil.',
  'os.remove',
  'os.rename',
  '.write(',
]
const OPENS_FOR_WRITING = /open\([^)]*['"][wax]/

const WRITING_TOOL_FLAGS: Readonly<Record<string, RegExp>> = {
  prettier: /^(--write|-w)$/,
  eslint: /^--fix$/,
  vitest: /^(-u|--update)$/,
  playwright: /^(-u|--update-snapshots)$/,
  ruff: /^(format|--fix|--fix-only)$/,
  sqlfluff: /^(fix|format)$/,
  pytest: /^(--update|--update-snapshots|--snapshot-update)$/,
  tbls: /^(doc|--output|-o)$/,
}
const SNAPSHOT_UPDATE = /^(-u|--update|--update-snapshots)$/
const GENERATOR_SCRIPT = /^(gen|generate|codegen|format|lint:fix|i18n:(extract|compile))(:[\w:-]+)?$/
const GENERATORS = new Set(['patch', 'lingui', 'openapi-typescript', 'tar', 'unzip'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

function inlineCode(command: ShellCommand): string | null {
  const flag = command.args.findIndex((arg) => INLINE_FLAGS.has(arg))

  if (!INTERPRETER.test(command.program)) return null
  if (flag !== -1) return command.args[flag + 1] ?? ''

  return command.redirects.find((redirect) => redirect.heredoc !== null)?.heredoc ?? null
}

const codeWrites = (code: string): boolean => OPENS_FOR_WRITING.test(code) || WRITES_IN_CODE.some((call) => code.includes(call))

function packageScriptWrites(args: readonly string[]): boolean {
  const [sub, script = ''] = args.filter((arg) => !arg.startsWith('-'))
  const passed = args.includes('--') ? args.slice(args.indexOf('--') + 1) : []

  return ((sub === 'run' || sub === 'run-script') && GENERATOR_SCRIPT.test(script)) || passed.some((arg) => SNAPSHOT_UPDATE.test(arg))
}

function writingTool(command: ShellCommand): boolean | null {
  const entry = pythonEntry(command)
  const module = entry?.kind === 'module' ? entry.value : command.program
  const writing = WRITING_TOOL_FLAGS[module]

  if (module === 'ruff' && command.args.includes('check') && !command.args.includes('--no-fix')) return true
  if (writing !== undefined) {
    if (module === 'ruff' && command.args.includes('format') && (command.args.includes('--check') || command.args.includes('--diff'))) {
      return false
    }

    return command.args.some((arg) => writing.test(arg))
  }

  return null
}

function runsGenerator(command: ShellCommand, hints: CommandHints): boolean {
  if (isGenerator(command, hints)) return true
  const tool = writingTool(command)

  if (tool !== null) return tool
  if (PACKAGE_MANAGERS.has(command.program)) return packageScriptWrites(command.args)
  const [sub] = command.args.filter((arg) => !arg.startsWith('-'))

  return GENERATORS.has(command.program) || (command.program === 'git' && sub === 'apply')
}

function writesBroadly(command: ShellCommand, root: string, hints: CommandHints): boolean {
  const code = inlineCode(command)

  return (code !== null && codeWrites(code)) || runsGenerator(command, hints) || writtenPaths(command, root).unplaced
}

// null when the command line only reads.
export function shellWrites(line: string, cwd: string, root: string, hints: CommandHints = NO_HINTS): WriteScope | null {
  const analysis = analyzeShell(line, cwd)

  if (readsOnly(line, cwd, hints)) return null
  if (!analysis.complete || analysis.commands.some((command) => writesBroadly(command, root, hints)))
    return analysis.complete ? 'all' : 'none'

  const paths = analysis.commands.flatMap((command) => writtenPaths(command, root).paths).map((path) => relative(root, path))

  return paths.length === 0 ? 'none' : paths
}

import { relative } from 'node:path'
import type { ShellCommand } from '../syntax/command.ts'
import { analyzeShell } from '../syntax/parse.ts'
import { NO_HINTS, type ScriptHints } from './hints.ts'
import { readsApartFromRedirects, readsOnly } from './read-only.ts'
import { namesItsWrites, writtenPaths } from './written-paths.ts'

// What a shell command line writes, as far as its words say: anything that changes while it runs (`all`), only the
// paths it names, or nothing (`none`), for writers that name no path.
export type WriteScope = 'all' | 'none' | readonly string[]

// They run the tool named after them, which is read as a command of its own.
const RUNNERS = new Set(['npx', 'bunx'])

// A program whose words do not say all it writes: a script, an interpreter, a generator, a tool Weaver does not know.
const opaque = (command: ShellCommand, hints: ScriptHints): boolean =>
  command.program !== '' && !RUNNERS.has(command.program) && !readsApartFromRedirects(command, hints) && !namesItsWrites(command)

// null when the command line only reads.
export function shellWrites(line: string, cwd: string, root: string, hints: ScriptHints = NO_HINTS): WriteScope | null {
  const analysis = analyzeShell(line, cwd)

  if (readsOnly(line, cwd, hints)) return null

  const broad = (command: ShellCommand): boolean => opaque(command, hints) || writtenPaths(command, root).unplaced

  if (!analysis.complete || analysis.commands.some(broad)) return 'all'

  const paths = analysis.commands.flatMap((command) => writtenPaths(command, root).paths).map((path) => relative(root, path))

  return paths.length === 0 ? 'none' : paths
}

import type { ShellCommand } from '../syntax/command.ts'

const PYTHON_VALUE_OPTIONS = new Set(['-W', '-X', '--check-hash-based-pycs'])

export interface PythonEntry {
  readonly kind: 'module' | 'script'
  readonly value: string
  readonly args: readonly string[]
}

function scriptEntry(args: readonly string[], index: number): PythonEntry {
  const scriptIndex = args[index] === '--' ? index + 1 : index

  return { kind: 'script', value: args[scriptIndex] ?? '', args: args.slice(scriptIndex + 1) }
}

export function pythonEntry(command: ShellCommand): PythonEntry | null {
  if (!/^python3?(\.\d+)?$/.test(command.program)) return null
  for (let index = 0; index < command.args.length; index += 1) {
    const arg = command.args[index] ?? ''

    if (['-c', '-'].includes(arg)) return null
    if (arg === '-m') return { kind: 'module', value: command.args[index + 1] ?? '', args: command.args.slice(index + 2) }
    if (PYTHON_VALUE_OPTIONS.has(arg)) {
      index += 1
      continue
    }

    if (arg.startsWith('-') && arg !== '--') continue

    return scriptEntry(command.args, index)
  }

  return null
}

import { execFileSync } from 'node:child_process'
import type { ProcessList, RunningProcess } from './process-list.ts'

// The processes as `ps` lists them, where there is no `/proc`.
export class PsList implements ProcessList {
  private listed: ReadonlyMap<number, RunningProcess> | null = null

  find(pid: number): RunningProcess | null {
    this.listed ??= this.list()

    return this.listed.get(pid) ?? null
  }

  private list(): Map<number, RunningProcess> {
    const processes = new Map<number, RunningProcess>()

    for (const line of this.output().split('\n')) {
      const [, pid, parent, command = ''] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? []

      if (pid !== undefined) processes.set(Number(pid), { parent: Number(parent), name: null, command: command.split(/\s+/) })
    }

    return processes
  }

  // One `-o` for each column: a BSD `ps` reads everything after `=` as the heading of the column.
  private output(): string {
    try {
      return execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return ''
    }
  }
}

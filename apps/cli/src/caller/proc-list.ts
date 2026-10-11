import { existsSync, readFileSync } from 'node:fs'
import type { ProcessList, RunningProcess } from './process-list.ts'

const ROOT = '/proc'

// The processes as Linux shows them under `/proc`.
export class ProcList implements ProcessList {
  static get isThere(): boolean {
    return existsSync(`${ROOT}/self/stat`)
  }

  find(pid: number): RunningProcess | null {
    try {
      const stat = readFileSync(`${ROOT}/${String(pid)}/stat`, 'utf8')
      const command = readFileSync(`${ROOT}/${String(pid)}/cmdline`, 'utf8').split('\0')
      // `pid (name) state parent ...`: the name may itself hold spaces and parentheses.
      const [open, close] = [stat.indexOf('('), stat.lastIndexOf(')')]
      const [, parent] = stat.slice(close + 2).split(' ')

      return { parent: Number(parent), name: stat.slice(open + 1, close), command: command.filter((word) => word !== '') }
    } catch {
      return null
    }
  }
}

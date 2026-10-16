import { basename } from 'node:path'
import type { Caller } from './caller.ts'
import { ProcList } from './proc-list.ts'
import type { ProcessList, RunningProcess } from './process-list.ts'
import { PsList } from './ps-list.ts'

const AGENTS = ['claude', 'codex']
// A runtime installed as a script runs as its interpreter, with the script as its first word.
const INTERPRETERS = new Set(['node', 'bun', 'deno'])
const MAX_DEPTH = 64

// Reads who runs the command from the processes that started it. The environment proves nothing: a variable of an
// outer agent session leaks into everything started under it, and a variable can be unset.
export class ProcessCaller implements Caller {
  private readonly processes: ProcessList
  private readonly pid: number

  constructor(processes: ProcessList = ProcList.isThere ? new ProcList() : new PsList(), pid: number = process.ppid) {
    this.processes = processes
    this.pid = pid
  }

  agent(): string | null {
    let pid = this.pid

    // The first process is looked at too: in the sandbox of Codex, the runtime itself is the process 1.
    for (let depth = 0; depth < MAX_DEPTH && pid > 0; depth += 1) {
      const running = this.processes.find(pid)

      if (running === null) return null

      const agent = this.agentOf(running)

      if (agent !== null) return agent

      pid = running.parent
    }

    return null
  }

  private agentOf({ name, command }: RunningProcess): string | null {
    const [program = '', script = ''] = command.map((word) => basename(word))
    // A runtime that updates itself runs a file named after its version, from the folder of its versions.
    const [, versioned = null] = /\/([^/]+)\/versions\/[^/]+$/.exec(command[0] ?? '') ?? []
    const names = [name, program, versioned, INTERPRETERS.has(program) ? script.replace(/\.[cm]?js$/, '') : null]

    return AGENTS.find((agent) => names.includes(agent)) ?? null
  }
}

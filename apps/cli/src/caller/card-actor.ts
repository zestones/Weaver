import type { Provenance } from '@weaver/memory'
import type { Caller } from './caller.ts'

export class CardActor {
  private readonly caller: Caller

  constructor(caller: Caller) {
    this.caller = caller
  }

  provenance(): Provenance {
    const agent = this.caller.agent()
    return {
      author: agent ?? 'owner',
      role: agent === null ? 'owner' : 'author',
      session: null,
      subagent: null,
      unit: null,
      requests: [],
      commit: null,
      at: new Date().toISOString(),
    }
  }
}

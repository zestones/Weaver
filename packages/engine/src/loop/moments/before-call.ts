import { CardRegistry } from '@weaver/memory'
import { FlagCall } from '../../flagging/calls/flag-call.ts'
import { FlagRecorder, type FlagAnswer } from '../../flagging/recording/flag-recorder.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { ProjectGuards } from '../../guards/deciding/project-guards.ts'
import type { Refusal } from '../../guards/results/refusal.ts'
import { NoteCall } from '../../noting/calls/note-call.ts'
import { NoteRecorder, type NoteAuthor } from '../../noting/recording/note-recorder.ts'
import { UnitLines } from '../../unit-of-work/diff/unit-lines.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class BeforeCall implements Moment {
  readonly speaksToOwner = false

  run(turn: Turn): Answer {
    const { call, callId } = turn.event

    if (call === null) return Answer.silent()

    const flag = FlagCall.in(call)
    const notes = NoteCall.among(call)

    // A flag and a note are answered here in place of their command, so no guard has a call to judge.
    if (flag !== null || notes.length > 0) {
      return Answer.refusing(
        [...(flag === null ? [] : [this.flagged(turn, flag)]), ...notes.map((note) => this.noted(turn, note))].join('\n'),
      )
    }

    const session = turn.session()
    const refusal = new ProjectGuards(turn.declaration, turn.repo).refusal(call)

    if (refusal !== null && !this.lifted(session, call, refusal)) {
      session?.log(refusal.event(call.name))

      return Answer.refusing(refusal.told(session?.shortId ?? null))
    }

    const writes = call.writes(turn.repo.top, turn.declaration.scripts)

    if (writes !== null && callId !== null) session?.watch(callId, { tool: call.name, ...writes, untilStop: call.background })

    return Answer.silent()
  }

  // In a session the owner put in maintenance, what a guard of the project refuses goes through and waits for them.
  private lifted(session: Session | null, call: ToolCall, refusal: Refusal): boolean {
    if (session === null || !refusal.liftable || session.maintenance === null) return false

    session.lift(call.name, refusal.lifted)

    return true
  }

  // A hook that fails lets its call through: the command would then run, and the agent would take its flag for made.
  private flagged(turn: Turn, flag: FlagCall): string {
    try {
      const session = turn.session()
      const answer = this.recorded(turn, flag, session)

      if (answer.card !== null) session?.flagged(answer.card.number, answer.known)

      return answer.message
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '')

      return `[weaver] The flag was not recorded, because Weaver failed: ${reason}. This command is answered here and never runs. Say what you wanted to flag in your final message, for the owner, and go on with your task.`
    }
  }

  // The author is never declared by the agent: the runtime says who calls.
  private recorded(turn: Turn, flag: FlagCall, session: Session | null): FlagAnswer {
    const { event, repo } = turn
    const unit = session?.unit() ?? null
    const lines = session === null || unit === null ? null : new UnitLines(session, unit)

    return this.inRegistry(turn, (registry) =>
      new FlagRecorder(repo, registry).record(
        { callId: event.callId, places: flag.places, body: flag.body ?? '', cwd: flag.cwd ?? event.cwd },
        { ...this.author(turn, session), written: (file) => lines?.of(file) ?? null },
      ),
    )
  }

  // A note is answered in place of its command too, for the same reason: the hook knows who writes it.
  private noted(turn: Turn, note: NoteCall): string {
    try {
      const session = turn.session()
      const answer = this.inRegistry(turn, (registry) =>
        new NoteRecorder(turn.repo, registry).record({ words: note.words, body: note.body }, this.author(turn, session)),
      )

      if (answer.card !== null && !answer.known) session?.noted(answer.card.number, answer.conclusion)

      return answer.message
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '')

      return `[weaver] The note was not written, because Weaver failed: ${reason}. This command is answered here and never runs. Say what you found in your final message, for the owner, and go on with your task.`
    }
  }

  private author(turn: Turn, session: Session | null): NoteAuthor {
    const unit = session?.unit() ?? null

    return {
      author: turn.agent.name,
      role: 'author',
      session: session?.id ?? null,
      subagent: turn.event.agentId,
      unit: unit?.number ?? null,
      requests: unit?.requests ?? [],
    }
  }

  private inRegistry<Result>(turn: Turn, work: (registry: CardRegistry) => Result): Result {
    const registry = new CardRegistry(turn.repo.stateDir)

    try {
      return work(registry)
    } finally {
      registry.close()
    }
  }
}

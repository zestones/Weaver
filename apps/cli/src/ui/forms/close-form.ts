import { Card, NoteReport, type Closing, type Concluded } from '@weaver/memory'
import type { Key } from 'ink'
import type { Form } from './form.ts'
import { TypedText } from './typed-text.ts'

const REASON_LIMIT = 100
// The key that picks each closing.
const KEYS: Readonly<Record<Closing, string>> = { fixed: 'f', wontfix: 'w', issue: 'i', invalid: 'v' }

interface Fields {
  readonly closing: Closing
  readonly reason: TypedText
  // Whether the keys go to the reason, or pick how the card closes.
  readonly typing: boolean
  readonly outcome: Form['outcome']
  readonly problem: string | null
}

// Closing a card: how, and why. A card someone concluded on starts with what they concluded: fixed closes as fixed,
// refuted as invalid, and the reason is what their report comes to, what was changed or what the investigation
// shows, which the owner corrects or keeps. A note that is no report gives its first line.
export class CloseForm implements Form {
  static readonly KEYS = KEYS

  readonly card: Card
  // The conclusion the reason was taken from; null when it was not taken from one.
  readonly taken: Concluded | null
  readonly closing: Closing
  readonly reason: TypedText
  readonly typing: boolean
  readonly outcome: Form['outcome']
  readonly problem: string | null

  private constructor(card: Card, taken: Concluded | null, fields: Fields) {
    this.card = card
    this.taken = taken
    this.closing = fields.closing
    this.reason = fields.reason
    this.typing = fields.typing
    this.outcome = fields.outcome
    this.problem = fields.problem
  }

  static for(card: Card): CloseForm {
    const concluded = card.conclusion
    const taken = concluded !== null && (concluded.as === 'fixed' || concluded.as === 'refuted') ? concluded : null
    const note = taken === null ? null : (card.record.notes.findLast((written) => written.provenance === taken.by) ?? null)
    const report = note === null || taken === null ? null : new NoteReport(taken.as, note.text)
    const [first = ''] = (report?.outcome ?? note?.text ?? '').split('\n')
    const reason = first.length > REASON_LIMIT ? `${first.slice(0, REASON_LIMIT - 1).trimEnd()}…` : first

    return new CloseForm(card, note === null ? null : taken, {
      closing: taken?.as === 'refuted' ? 'invalid' : 'fixed',
      reason: new TypedText(reason),
      // A reason that was taken from a note is what the owner looks at first: the keys go to it.
      typing: note !== null,
      outcome: 'open',
      problem: null,
    })
  }

  pressed(input: string, key: Key): CloseForm {
    if (key.escape) return this.with({ outcome: 'cancelled' })
    if (key.return) return this.with({ outcome: 'submitted' })
    if (key.tab) return this.with({ typing: !this.typing })

    const at = Card.CLOSINGS.indexOf(this.closing)

    // The arrows pick how the card closes wherever the keys go: a reason has no use for them.
    if (key.upArrow) return this.with({ closing: Card.CLOSINGS[Math.max(0, at - 1)] ?? this.closing, problem: null })
    if (key.downArrow)
      return this.with({ closing: Card.CLOSINGS[Math.min(Card.CLOSINGS.length - 1, at + 1)] ?? this.closing, problem: null })
    if (this.typing) return this.with({ reason: this.reason.pressed(input, key) ?? this.reason, problem: null })

    const picked = Card.CLOSINGS.find((closing) => KEYS[closing] === input)

    return picked === undefined ? this : this.with({ closing: picked, problem: null })
  }

  refused(problem: string): CloseForm {
    return this.with({ outcome: 'open', problem })
  }

  private with(change: Partial<Fields>): CloseForm {
    const { closing, reason, typing, outcome, problem } = this

    return new CloseForm(this.card, this.taken, { closing, reason, typing, outcome, problem, ...change })
  }
}

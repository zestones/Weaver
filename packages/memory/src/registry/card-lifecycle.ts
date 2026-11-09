import { Card } from '../cards/card.ts'
import type { CardRecord, Conclusion, ResolutionStage } from '../cards/card-record.ts'
import { ClosingDraft } from '../notes/closing-draft.ts'

export class CardLifecycle {
  reconcile(record: CardRecord): CardRecord {
    const reopened = record.history.findLast((event) => event.action === 'reopened')
    const noteStart =
      record.lifecycle?.noteStart ??
      (reopened === undefined
        ? 0
        : record.history.slice(0, record.history.lastIndexOf(reopened)).filter((event) => event.action === 'noted').length)
    const notes = record.notes.map((note, index) => ({ ...note, id: note.id ?? `note-${String(index + 1)}` }))
    const current = notes.slice(noteStart)
    const decision = new Card(record).decision
    const conclusion: Conclusion | null =
      current.findLast(
        (note) =>
          note.conclusion !== null && note.conclusion !== 'no-decision' && (note.conclusion !== 'needs-owner' || decision.kind === 'owner'),
      )?.conclusion ?? (reopened === undefined && record.flag?.fields.did === 'fixed' ? 'fixed' : null)
    const stage: ResolutionStage =
      decision.kind === 'owner'
        ? 'needs-owner'
        : conclusion === null
          ? 'uninvestigated'
          : conclusion === 'fixed' || conclusion === 'refuted' || conclusion === 'needs-owner' || conclusion === 'deferred'
            ? conclusion
            : 'investigated'
    const revision = record.lifecycle?.revision ?? record.history.length
    const lifecycle = {
      revision,
      cycle: record.lifecycle?.cycle ?? record.history.filter((event) => event.action === 'reopened').length,
      noteStart,
      stage,
    }

    return { ...record, notes, lifecycle, proposal: new ClosingDraft(record, current).proposal(conclusion, revision) }
  }
}

import { Card } from '../cards/card.ts'
import type { CardNote, CardRecord, ClosingProposal, Conclusion } from '../cards/card-record.ts'
import { NoteReport } from './note-report.ts'

export class ClosingDraft {
  private readonly record: CardRecord
  private readonly notes: readonly CardNote[]

  constructor(record: CardRecord, notes: readonly CardNote[]) {
    this.record = record
    this.notes = notes
  }

  proposal(conclusion: Conclusion | null, revision: number): ClosingProposal | null {
    if (
      new Card(this.record).decision.kind === 'owner' ||
      this.record.state !== 'open' ||
      (conclusion !== 'fixed' && conclusion !== 'refuted')
    )
      return null

    const last = this.notes.findLast((note) => note.conclusion === conclusion)
    const investigation = this.notes.findLast(
      (note) => note.conclusion === 'confirmed' || note.conclusion === 'refuted' || note.conclusion === 'unsure',
    )
    const field = (note: CardNote | undefined, name: string): string | null => {
      if (note?.conclusion == null) return null
      return new NoteReport(note.conclusion, note.text).fields.find((entry) => entry.name === name)?.said || null
    }
    const explicitCause =
      this.notes
        .findLast((note) => /^Cause:/im.test(note.text))
        ?.text.match(/^Cause:[ \t]*([\s\S]*?)(?=^(?:Changed|Verified|Left|Ran|Read|Shows):|(?![\s\S]))/im)?.[1]
        ?.trim() || null
    const cause = explicitCause ?? field(investigation, 'Shows') ?? 'cause not recorded'
    const fix =
      conclusion === 'refuted'
        ? 'Refuted: no fix proposed.'
        : (field(last, 'Changed') ?? this.record.flag?.fields.didNote ?? 'fix not recorded')
    const verified = field(last, conclusion === 'fixed' ? 'Verified' : 'Ran')
    const warning =
      verified === null ||
      /^(?:no\b(?!\s+(?:errors|failures|regressions)\b)|none\b|nothing\b|unverified\b)|\b(?:not (?:run|verified|tested|checked)|did not (?:run|verify|test|check))\b/i.test(
        verified,
      )
    const verification = warning ? `verification not run${verified === null ? '' : `: ${verified}`}` : verified
    const remaining = field(last, 'Left') ?? 'remaining work not recorded'
    const evidence = this.notes.map((note) => note.id ?? '')
    const excerpts = this.notes.map((note) => `### ${note.id ?? 'Note'} — ${note.provenance.author}, ${note.provenance.at}\n\n${note.text}`)
    const reason = [
      `Cause: ${cause}`,
      `Fix: ${fix}`,
      `Verification: ${verification}`,
      `Remaining: ${remaining}`,
      ...(warning ? ['Warning: verification not run.'] : []),
      ...excerpts,
    ].join('\n\n')

    return {
      draftedBy: 'weaver',
      as: conclusion === 'fixed' ? 'fixed' : 'invalid',
      reason,
      by: last?.provenance ?? this.record.provenance,
      revision,
      evidence,
      cause,
      fix,
      verification,
      remaining,
      warning,
    }
  }
}

import type { ReviewerName, ReviewPolicy } from '../../declaration/content/review-policy.ts'
import { matchesAny } from '../../lib/text/glob.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { OwnerDirectives } from './owner-directives.ts'

export interface ReviewAssignment {
  readonly runtime: ReviewerName
  // Why this runtime, in words the owner reads in the report.
  readonly reason: string
  readonly model: string | null
  readonly effort: string | null
  readonly timeoutSeconds: number
  readonly experiments: boolean
}

interface Choice {
  readonly runtime: ReviewerName
  readonly reason: string
}

// Who reviews: the runtime that did not write the change where a mistake costs the most, the one the project names
// otherwise. The author never chooses.
export class ReviewRouting {
  private readonly policy: ReviewPolicy
  private readonly directives: OwnerDirectives

  constructor(policy: ReviewPolicy, directives: OwnerDirectives) {
    this.policy = policy
    this.directives = directives
  }

  assign(author: string, diff: UnitDiff): ReviewAssignment {
    const { policy } = this
    const choice = this.choice(author, diff)

    return {
      ...choice,
      ...policy.reviewers[choice.runtime],
      timeoutSeconds: policy.timeoutSeconds,
      experiments: policy.experiments,
    }
  }

  private choice(author: string, diff: UnitDiff): Choice {
    const { runtime, criticalLines } = this.policy
    const same: ReviewerName = author === 'codex' ? 'codex' : 'claude'
    const other: ReviewerName = same === 'codex' ? 'claude' : 'codex'
    const critical = this.criticalPaths(diff)
    const lines = diff.addedLines

    if (this.directives.critical) return { runtime: other, reason: '#critical in the request' }
    if (this.directives.simple) return { runtime: same, reason: '#simple in the request' }
    if (critical.length > 0) return { runtime: other, reason: `critical path: ${critical.join(', ')}` }
    if (criticalLines !== null && lines > criticalLines) {
      return { runtime: other, reason: `${String(lines)} changed lines, more than ${String(criticalLines)}` }
    }
    if (runtime === 'same') return { runtime: same, reason: 'the runtime that wrote the change' }
    if (runtime === 'other') return { runtime: other, reason: 'the runtime that did not write the change' }

    return { runtime, reason: 'the runtime the project names' }
  }

  // A file moved into or out of a critical path touches it either way.
  private criticalPaths(diff: UnitDiff): string[] {
    const globs = this.policy.criticalPaths

    return diff.files.flatMap((file) => {
      if (matchesAny(globs, file.path)) return [file.path]

      return matchesAny(globs, file.oldPath) ? [`${file.oldPath} -> ${file.path}`] : []
    })
  }
}

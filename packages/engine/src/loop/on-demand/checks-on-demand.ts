import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CheckMemory } from '../../checks/results/check-memory.ts'
import type { CheckOutcome } from '../../checks/results/check-outcome.ts'
import type { CheckRunner } from '../../checks/running/check-runner.ts'
import { ProjectChecks } from '../../checks/running/project-checks.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { Repository } from '../../lib/git/repository.ts'
import { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { EventBody } from '../../unit-of-work/journal/journal-event.ts'
import { Journal } from '../../unit-of-work/journal/journal.ts'
import { RepositorySessions } from '../../unit-of-work/session/repository-sessions.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitFile } from '../../unit-of-work/unit/unit-record.ts'

// A runtime may ask its owner before it runs a command: the command claims what its hook saw that long after.
const ASKED_WITHIN_MS = 10 * 60 * 1000
// Where the owner's own checks keep their trees and what they said, apart from every session.
const OWNER_DIR = 'owner-checks'

export interface AskedVerdict {
  // The unit of work judged; null for the owner's changes, judged against HEAD.
  readonly unit: number | null
  readonly files: readonly string[]
  // What changed during the session's commands without being charged to it, and is not judged.
  readonly unattributed: readonly string[]
  readonly outcomes: readonly CheckOutcome[]
}

// The checks of the project, run in the middle of a task as its end would run them: the same trees and the same
// commands. Nothing ends, settles or counts as a refusal, and repairs are left to the end of the task. What each check
// says is kept: an end of task that finds nothing changed since gives it again without running it.
export class ChecksOnDemand {
  static readonly COMMAND = 'check'

  private readonly repo: Repository
  private readonly checks: CheckRunner

  constructor(repo: Repository, checks: CheckRunner = new ProjectChecks()) {
    this.repo = repo
    this.checks = checks
  }

  // The names of checks among the words that follow `weaver check`, as the hook and the command both read them.
  static namesIn(words: readonly string[]): string[] {
    return words.filter((word) => !word.startsWith('-'))
  }

  // The session whose hook saw its agent run `weaver check` with these names; null when no hook did. What the hook saw
  // tells whose command it is better than the processes do: a runtime may run its commands under any name.
  sessionAsking(names: readonly string[]): Session | null {
    const since = new Date(Date.now() - ASKED_WITHIN_MS).toISOString()

    return new RepositorySessions(this.repo).all().find((session) => session.takeAsked(names, since)) ?? null
  }

  // A check runs after the one it waits for, which runs too. Without a name, every check runs.
  async run(declaration: Declaration, names: readonly string[], session: Session | null): Promise<AskedVerdict> {
    const startedAt = Date.now()
    const chosen = names.length === 0 ? declaration : declaration.withChecks(this.withPrerequisites(declaration, names))
    const unit = session?.unit() ?? null
    const files = unit?.files ?? this.ownerFiles()
    const dir = session === null ? join(this.repo.stateDir, OWNER_DIR) : join(session.dir, 'asked')

    // Its own index and trees: the end of a task may be building the session's at the same time.
    mkdirSync(dir, { recursive: true })

    const diff = UnitDiff.of(this.repo, dir, files, declaration.exclude)
    const memory = new CheckMemory(session?.dir ?? dir)
    const outcomes =
      diff.files.length === 0 ? [] : await this.checks.judge(chosen, diff, declaration.checkLimits.deadlineFrom(startedAt), memory)
    const event: EventBody = {
      kind: 'asked',
      unit: unit?.number ?? null,
      passed: !outcomes.some((outcome) => outcome.blocking),
      failed: outcomes.filter((outcome) => outcome.blocking).map((outcome) => outcome.id),
      files: diff.files.length,
      ms: Date.now() - startedAt,
      checks: outcomes.map((outcome) => outcome.run),
    }

    if (session === null) new Journal(this.repo).append({ session: null, agent: null }, event)
    else session.log(event)

    return { unit: unit?.number ?? null, files: diff.paths, unattributed: unit?.unattributed ?? [], outcomes }
  }

  private withPrerequisites(declaration: Declaration, names: readonly string[]): Set<string> {
    const known = new Map(declaration.checks.map((check) => [check.id, check]))
    const unknown = names.filter((name) => !known.has(name))

    if (unknown.length > 0) {
      throw new Error(`the project declares no check named ${unknown.join(', ')}: its checks are ${[...known.keys()].join(', ')}`)
    }

    const ids = new Set<string>()
    const waiting = [...names]

    for (let id = waiting.pop(); id !== undefined; id = waiting.pop()) {
      const after = known.get(id)?.after ?? null

      ids.add(id)
      if (after !== null && !ids.has(after)) waiting.push(after)
    }

    return ids
  }

  // Outside a session, the changes are the owner's: every file that differs from HEAD.
  private ownerFiles(): Record<string, UnitFile> {
    const paths = this.repo.dirtyPaths()
    const atHead = this.repo.blobsAt('HEAD', paths)
    const now = this.repo.hashPaths(paths)

    return Object.fromEntries(
      paths.map((path) => [
        path,
        { base: atHead.get(path) ?? null, last: now.get(path) ?? null, foreign: false, touchedAt: '', since: '' },
      ]),
    )
  }
}

import { join } from 'node:path'
import { AgentCatalog } from '../../src/agents/runtimes/agent-catalog.ts'
import { Payload } from '../../src/agents/events/payload.ts'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import type { CheckRunner } from '../../src/checks/running/check-runner.ts'
import type { ReviewRequest } from '../../src/review/request/review-request.ts'
import { ReviewOutcome } from '../../src/review/results/review-outcome.ts'
import { InlineLauncher } from '../../src/review/launching/inline-launcher.ts'
import { ReviewRounds } from '../../src/review/rounds/review-rounds.ts'
import type { ReviewAssignment } from '../../src/review/routing/review-routing.ts'
import type { Reviewer } from '../../src/review/running/reviewer.ts'
import type { Declaration } from '../../src/declaration/content/declaration.ts'
import { DeclarationFile } from '../../src/declaration/reading/declaration-file.ts'
import { AfterCall } from '../../src/loop/moments/after-call.ts'
import type { Answer, AnswerBody } from '../../src/loop/exchange/answer.ts'
import { BeforeCall } from '../../src/loop/moments/before-call.ts'
import { EndOfTurn } from '../../src/loop/moments/end-of-turn.ts'
import { OnRequest } from '../../src/loop/moments/on-request.ts'
import { Turn } from '../../src/loop/exchange/turn.ts'
import type { Session } from '../../src/unit-of-work/session/session.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import type { EventBody, EventOf } from '../../src/unit-of-work/journal/journal-event.ts'
import type { SessionRecord } from '../../src/unit-of-work/session/session-record.ts'
import { writeFiles } from './repo.ts'

type Raw = Record<string, unknown>

export interface CheckStub extends CheckRunner {
  readonly calls: { count: number }
  readonly seen: string[][]
}

export interface ReviewerStub extends Reviewer {
  readonly requests: ReviewRequest[]
  readonly assignments: ReviewAssignment[]
}

export const A_FILE = 'src/a.ts'
export const B_FILE = 'src/b.ts'
const FINISHED = '## Request\n\nDone.\n\n## To validate\n\nNothing.\n'
const AGENTS = new AgentCatalog()
// The one check of the project these tests declare, with the rule it stands behind.
export const LINT = { verify: ['true'], rules: { L1: 'The code passes the linter.' } }
const REVIEW_POLL_MS = 2

export const declaration = (extra: Raw = {}): Declaration =>
  new DeclarationFile('weaver.config.json').parse(
    JSON.stringify({
      version: 1,
      checks: { lint: LINT },
      ...extra,
    }),
  )

export const FAILING = new CheckOutcome({
  id: 'lint',
  rules: ['L1'],
  status: 'fail',
  blocking: true,
  ms: 1,
  output: 'src/a.ts:1:1 error max-lines-per-function',
})
export const PASSING = new CheckOutcome({ ...FAILING, status: 'pass', blocking: false, output: '' })

let toolCalls = 0

function turnOf(session: Session, raw: Raw, project: Declaration = declaration()): Turn {
  const agent = AGENTS.fromArguments([`--agent=${session.agent}`])
  const event = agent.read(new Payload({ session_id: session.id, cwd: session.repo.top, ...raw }))

  return new Turn(agent, event, session.repo, project)
}

export function startTool(session: Session, tool: Raw, project?: Declaration): () => Answer {
  toolCalls += 1

  const call = { ...tool, tool_use_id: `tool-${String(toolCalls)}` }

  new BeforeCall().run(turnOf(session, call, project))

  return () => new AfterCall().run(turnOf(session, call, project))
}

function useTool(session: Session, tool: Raw, effect: () => void, project?: Declaration): Answer {
  const end = startTool(session, tool, project)

  effect()

  return end()
}

export const bashCall = (command: string, input: Raw = {}): Raw => ({ tool_name: 'Bash', tool_input: { command, ...input } })

const writeCall = (session: Session, path: string, content: string): Raw =>
  session.agent === 'codex'
    ? { tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+${content}\n*** End Patch` } }
    : { tool_name: 'Write', tool_input: { file_path: join(session.repo.top, path), content } }

export const stateOf = (session: Session): SessionRecord | null => session.state()

export const unitFiles = (session: Session): string[] => Object.keys(stateOf(session)?.unit.files ?? {}).sort()

export function eventsOf<Kind extends EventBody['kind']>(session: Session, kind: Kind): EventOf<Kind>[] {
  return new Journal(session.repo).read().filter((event): event is EventOf<Kind> => event.kind === kind)
}

export function prompt(session: Session, text: string): void {
  new OnRequest().run(turnOf(session, { prompt: text }))
}

export function agentWrites(session: Session, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    useTool(session, writeCall(session, path, content), () => {
      writeFiles(session.repo.top, { [path]: content })
    })
  }
}

export function agentRuns(session: Session, command: string, effect: () => void, project?: Declaration): Answer {
  return useTool(session, bashCall(command), effect, project)
}

export function stubChecks(outcomes: readonly CheckOutcome[], during: () => Promise<void> = () => Promise.resolve()): CheckStub {
  const calls = { count: 0 }
  const seen: string[][] = []

  return {
    calls,
    seen,
    repairs: () => false,
    repair: () => Promise.resolve(),
    verify: async (_declaration, unit) => {
      calls.count += 1
      seen.push(unit.paths)
      await during()

      return outcomes
    },
  }
}

export function stubReviewer(outcomes: readonly ReviewOutcome[]): ReviewerStub {
  const left = [...outcomes]
  const requests: ReviewRequest[] = []
  const assignments: ReviewAssignment[] = []

  return {
    requests,
    assignments,
    review: (request, assignment) => {
      requests.push(request)
      assignments.push(assignment)

      return Promise.resolve(
        left.shift() ?? new ReviewOutcome({ runtime: assignment.runtime, seconds: 0, failure: 'no review was expected' }),
      )
    },
  }
}

export async function finishWith(
  session: Session,
  checks: CheckRunner,
  project: Declaration = declaration(),
  message = FINISHED,
  reviewer: Reviewer = stubReviewer([]),
): Promise<AnswerBody> {
  return finishThrough(session, checks, new ReviewRounds(new InlineLauncher(reviewer), REVIEW_POLL_MS), project, message)
}

export async function finishThrough(
  session: Session,
  checks: CheckRunner,
  reviews: ReviewRounds,
  project: Declaration = declaration(),
  message = FINISHED,
): Promise<AnswerBody> {
  const answer = await new EndOfTurn(checks, reviews).run(turnOf(session, { last_assistant_message: message }, project))

  return answer.body ?? {}
}

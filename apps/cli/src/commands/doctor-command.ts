import type { ExecutionCatalog } from '@weaver/agent-sdk'
import { DeclarationParts, type Declaration, type ReviewPolicy, type ReviewerName } from '@weaver/engine'
import type { EngineLink } from '../link/engine-link.ts'
import type { Output } from '../output/output.ts'
import { Project } from '../project/project.ts'
import { RuntimeCatalog } from '../runtimes/runtime-catalog.ts'
import { RuntimeSettings } from '../runtimes/runtime-settings.ts'
import type { Command } from './command.ts'

interface Finding {
  readonly state: 'ok' | 'problem' | 'note'
  readonly text: string
}

const MARKS = { ok: 'ok     ', problem: 'PROBLEM', note: '-      ' }
const REVIEWERS: readonly ReviewerName[] = ['claude', 'codex']
const WHO: Readonly<Record<string, string>> = {
  same: 'the runtime that wrote the change',
  other: 'the runtime that did not write the change',
}

export class DoctorCommand implements Command {
  readonly name = 'doctor'
  readonly usage = 'doctor'
  readonly summary = 'Check that Weaver is alive in this project: its configuration, its hook, and each agent runtime.'
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink
  private readonly executions: ExecutionCatalog

  constructor(cwd: string, output: Output, link: EngineLink, executions: ExecutionCatalog) {
    this.cwd = cwd
    this.output = output
    this.link = link
    this.executions = executions
  }

  run(): number {
    const project = Project.locate(this.cwd)
    const runtimes = new RuntimeCatalog().settings(project.top, this.link, [])
    const findings = [
      this.configuration(project),
      ...this.finishSkill(project),
      ...this.review(project),
      this.hook(),
      ...runtimes.map((runtime) => this.runtime(runtime)),
      this.anyRuntime(runtimes),
    ]

    for (const finding of findings) this.output.say(`${MARKS[finding.state]} ${finding.text}`)

    return findings.some((finding) => finding.state === 'problem') ? 1 : 0
  }

  private configuration(project: Project): Finding {
    try {
      const declaration = project.declaration()

      if (declaration === null) {
        return {
          state: 'problem',
          text: `no ${project.configName}/settings.json: Weaver does nothing in this project. Run weaver install.`,
        }
      }

      const { rules, checks, guards } = declaration

      return {
        state: 'ok',
        text: `${project.configName}: ${String(rules.length)} rule(s), ${String(checks.length)} check(s), ${String(guards.length)} guard(s)`,
      }
    } catch (error) {
      return { state: 'problem', text: error instanceof Error ? error.message : String(error) }
    }
  }

  // The agent is pointed to the skill, and the configuration waits for the headings the skill shows.
  private finishSkill(project: Project): Finding[] {
    const skill = project.finishSkill()

    if (skill === null) return []
    if (!skill.exists)
      return [{ state: 'problem', text: `${skill.path} is missing, and agents are pointed to it. Run weaver install to write a template.` }]

    const missing = skill.missingHeadings()

    return missing.length === 0
      ? [{ state: 'ok', text: `the finish skill: ${skill.path}` }]
      : [
          {
            state: 'problem',
            text: `${skill.path} does not show ${missing.map((heading) => `## ${heading}`).join(', ')}, which its header lists.`,
          },
        ]
  }

  private review(project: Project): Finding[] {
    const declaration = project.readableDeclaration()
    const judged = declaration?.rules.filter((rule) => rule.level === 'llm').length ?? 0

    if (declaration === null || declaration.review === null) return []

    return [...this.reviewers(declaration.review, judged), ...this.reviewSkill(project), ...this.reviewTime(declaration)]
  }

  private reviewers(policy: ReviewPolicy, judged: number): Finding[] {
    const who = WHO[policy.runtime] ?? policy.runtime
    const where = policy.experiments ? ', in a copy of the project where the reviewer may experiment' : ''
    // Any of the two runtimes may then be the one that reviews.
    const routed = policy.runtime in WHO || policy.criticalPaths.length > 0 || policy.criticalLines !== null
    const review: Finding =
      judged === 0
        ? { state: 'note', text: `the review is by ${who}, and it has no rule: it has nothing to judge` }
        : { state: 'ok', text: `the review: by ${who}, for ${String(judged)} rule(s)${where}` }

    return [review, ...REVIEWERS.flatMap((name) => this.reviewer(name, policy, routed || policy.runtime === name))]
  }

  private reviewer(name: ReviewerName, policy: ReviewPolicy, expected: boolean): Finding[] {
    const { model } = policy.reviewers[name]
    const named = model === null ? name : `${name} on ${model}`

    if (this.executions.find(name)?.isAvailable() === true) return expected ? [{ state: 'ok', text: `the reviewer ${named} starts` }] : []

    return expected
      ? [{ state: 'problem', text: `${named} may review here, and the ${name} command does not start: its reviews fail.` }]
      : [{ state: 'note', text: `the ${name} command does not start: a request marked #critical has no reviewer` }]
  }

  private reviewSkill(project: Project): Finding[] {
    const skill = project.reviewSkill()

    if (skill === null) return []

    return skill.exists
      ? [{ state: 'ok', text: `the review skill: ${skill.path}` }]
      : [{ state: 'problem', text: `${skill.path} is missing, and the reviewer is pointed to it. Run weaver install to write a template.` }]
  }

  // A hook the runtime stops before its end says nothing: the unit of work would stay open without a word. A review
  // that takes longer than the wait goes on by itself, so only the wait counts.
  private reviewTime(declaration: Declaration): Finding[] {
    const checks = declaration.checkLimits.totalTimeoutSeconds
    const wait = declaration.review?.waitSeconds ?? 0
    const given = RuntimeSettings.END_OF_TURN_SECONDS
    const files = DeclarationParts.FILES

    return checks + wait <= given
      ? []
      : [
          {
            state: 'problem',
            text: `the checks (${String(checks)} s) and the wait for a review (${String(wait)} s) may last longer than the ${String(given)} s the end of a turn is given: lower checks.totalTimeoutSeconds in ${files.settings} or waitSeconds in ${files.reviewers}.`,
          },
        ]
  }

  private hook(): Finding {
    return this.link.isAlive()
      ? { state: 'ok', text: `the hook starts: ${this.link.hook}` }
      : { state: 'problem', text: `the hook does not start: ${this.link.hook}. Build Weaver with pnpm build.` }
  }

  private runtime(runtime: RuntimeSettings): Finding {
    const wiring = runtime.wiring()

    if (wiring === 'installed') return { state: 'ok', text: `${runtime.label}: wired in ${runtime.file}` }
    if (wiring === 'absent') return { state: 'note', text: `${runtime.label}: not wired` }

    return { state: 'problem', text: `${runtime.label}: the hooks in ${runtime.file} point somewhere else. Run weaver install.` }
  }

  // With no runtime wired, no agent calls Weaver: nothing is refused and nothing is checked, without a word.
  private anyRuntime(runtimes: readonly RuntimeSettings[]): Finding {
    return runtimes.some((runtime) => runtime.wiring() !== 'absent')
      ? { state: 'note', text: 'an agent started outside these runtimes is not supervised' }
      : { state: 'problem', text: 'no agent runtime is wired: agents work here unsupervised. Run weaver install.' }
  }
}

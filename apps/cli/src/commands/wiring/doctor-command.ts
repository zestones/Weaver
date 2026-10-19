import { existsSync } from 'node:fs'
import type { ExecutionCatalog, RuntimeHook } from '@weaver/agent-sdk'
import { DeclarationParts, RepositorySessions, type Declaration, type ReviewPolicy, type ReviewerName } from '@weaver/engine'
import { RegistryError, type Card } from '@weaver/memory'
import type { EngineLink } from '../../link/engine-link.ts'
import { OwnRelease } from '../../link/own-release.ts'
import { Counted } from '../../output/counted.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import { RuntimeCatalog } from '../../runtimes/runtime-catalog.ts'
import { RuntimeSettings } from '../../runtimes/runtime-settings.ts'
import { StatusMod } from '../../skills/status-mod.ts'
import type { Command } from '../line/command.ts'

interface Finding {
  readonly state: 'ok' | 'problem' | 'note'
  readonly text: string
}

const REVIEWERS: readonly ReviewerName[] = ['claude', 'codex']
const WHO: Readonly<Record<string, string>> = {
  same: 'the runtime that wrote the change',
  other: 'the runtime that did not write the change',
}

export class DoctorCommand implements Command {
  readonly name = 'doctor'
  readonly usage = 'doctor'
  readonly summary = 'Check that Weaver is alive in this project'
  readonly ownerOnly = false
  readonly help = {
    group: 'Set up',
    description: 'Check that Weaver is alive in this project: its configuration, its hook, and each agent runtime.',
    words: [],
    examples: ['weaver doctor'],
  } as const
  private readonly cwd: string
  private readonly screen: Screen
  private readonly link: EngineLink
  private readonly executions: ExecutionCatalog

  constructor(cwd: string, output: Output, link: EngineLink, executions: ExecutionCatalog) {
    this.cwd = cwd
    this.screen = new Screen(output)
    this.link = link
    this.executions = executions
  }

  async run(): Promise<number> {
    const project = Project.locate(this.cwd)
    const runtimes = new RuntimeCatalog().settings(project.top, this.link, [])
    const held = await Promise.all(runtimes.map((runtime) => this.held(runtime, project.top)))
    const wired = runtimes.flatMap((runtime, index) => [
      this.runtime(runtime),
      ...this.guide(project, runtime),
      ...this.mod(project, runtime),
      ...(held[index] ?? []),
    ])
    const sections: readonly (readonly [string, readonly Finding[]])[] = [
      ['Project', [this.configuration(project), ...this.warnings(project), ...this.limits(project), ...this.finishSkill(project)]],
      ['Review', this.review(project)],
      ['Cards', [...this.writer(project), ...this.cards(project)]],
      ['Sessions', this.maintenance(project)],
      ['Runtimes', [this.hook(), ...wired, this.anyRuntime(runtimes)]],
    ]
    const problems = sections.flatMap(([, findings]) => findings).filter((finding) => finding.state === 'problem').length

    for (const [title, findings] of sections) this.section(title, findings)

    this.screen.line()
    if (problems === 0) this.screen.done('Weaver is alive in this project.')
    else this.screen.problem(`${new Counted(problems, 'problem').text} to settle.`)

    return problems === 0 ? 0 : 1
  }

  // What was raised elsewhere is said as a sentence here, as the other findings are.
  private sentence(message: string): string {
    return `${message.charAt(0).toUpperCase()}${message.slice(1)}`
  }

  // Nothing is said of a part of Weaver the project does not use.
  private section(title: string, findings: readonly Finding[]): void {
    if (findings.length === 0) return

    this.screen.heading(title)

    for (const { state, text } of findings) {
      if (state === 'ok') this.screen.done(text, 1)
      else if (state === 'problem') this.screen.problem(text, 1)
      else this.screen.note(text, 1)
    }
  }

  private configuration(project: Project): Finding {
    try {
      const behind = project.migrations().pending()

      if (behind.length > 0) {
        const labels = behind.map((migration) => migration.label).join(', ')

        return {
          state: 'problem',
          text: `${project.configName}/ is ${new Counted(behind.length, 'migration').text} behind this Weaver (${labels}): nothing is checked until weaver update brings it up to date.`,
        }
      }

      const declaration = project.declaration()

      if (declaration === null) {
        return {
          state: 'problem',
          text: `No ${project.configName}/settings.json: Weaver does nothing in this project. Run weaver install.`,
        }
      }

      const { rules, checks, guards } = declaration

      return {
        state: 'ok',
        text: `${project.configName}: ${new Counted(rules.length, 'rule').text}, ${new Counted(checks.length, 'check').text}, ${new Counted(guards.length, 'guard').text}`,
      }
    } catch (error) {
      return { state: 'problem', text: this.sentence(error instanceof Error ? error.message : String(error)) }
    }
  }

  // A check given more time than the checks share at the end of a task is cut by their time, and its own file does not
  // say so.
  private limits(project: Project): Finding[] {
    const declaration = project.readableDeclaration()

    if (declaration === null) return []

    const shared = declaration.checkLimits.totalTimeoutSeconds

    return declaration.checks
      .filter((check) => check.timeoutSeconds > shared)
      .map((check) => ({
        state: 'problem',
        text: `\`${check.id}\` is given ${String(check.timeoutSeconds)} s, but the checks share ${String(shared)} s at the end of a task, which cuts it first: raise checks.totalTimeoutSeconds in ${DeclarationParts.FILES.settings}, or lower its timeoutSeconds in ${DeclarationParts.FILES.checks}.`,
      }))
  }

  // A hook the runtime stops before its end says nothing: the warnings must end before the call is given up on.
  private warnings(project: Project): Finding[] {
    const declaration = project.readableDeclaration()
    const warning = declaration?.checks.filter((check) => check.warn !== null).length ?? 0

    if (declaration === null || warning === 0) return []

    const time = declaration.checkLimits.warnTimeoutSeconds
    const given = RuntimeSettings.AFTER_CALL_SECONDS

    return time < given
      ? [
          {
            state: 'ok',
            text: `${new Counted(warning, 'check warns', 'checks warn').text} right after a call, in ${String(time)} s at most`,
          },
        ]
      : [
          {
            state: 'problem',
            text: `The warnings after a call (${String(time)} s) may last longer than the ${String(given)} s the end of a call is given: lower checks.warnTimeoutSeconds in ${DeclarationParts.FILES.settings}.`,
          },
        ]
  }

  // The agent is pointed to the skill, and the configuration waits for the headings the skill shows.
  private finishSkill(project: Project): Finding[] {
    const skill = project.finishSkill()

    if (skill === null) return []
    if (!skill.exists)
      return [{ state: 'problem', text: `${skill.path} is missing, and agents are pointed to it. Run weaver install to write a template.` }]

    const missing = skill.missingHeadings()

    return missing.length === 0
      ? [{ state: 'ok', text: `The finish skill: ${skill.path}` }]
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
        ? { state: 'note', text: `The review is by ${who}, and it has no rule: it has nothing to judge` }
        : { state: 'ok', text: `The review: by ${who}, for ${new Counted(judged, 'rule').text}${where}` }

    return [review, ...REVIEWERS.flatMap((name) => this.reviewer(name, policy, routed || policy.runtime === name))]
  }

  private reviewer(name: ReviewerName, policy: ReviewPolicy, expected: boolean): Finding[] {
    const { model } = policy.reviewers[name]
    const named = model === null ? name : `${name} on ${model}`

    if (this.executions.find(name)?.isAvailable() === true) return expected ? [{ state: 'ok', text: `The reviewer ${named} starts` }] : []

    return expected
      ? [{ state: 'problem', text: `${named} may review here, and the ${name} command does not start: its reviews fail.` }]
      : [{ state: 'note', text: `The ${name} command does not start: a request marked #critical has no reviewer` }]
  }

  private reviewSkill(project: Project): Finding[] {
    const skill = project.reviewSkill()

    if (skill === null) return []

    return skill.exists
      ? [{ state: 'ok', text: `The review skill: ${skill.path}` }]
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
            text: `The checks (${String(checks)} s) and the wait for a review (${String(wait)} s) may last longer than the ${String(given)} s the end of a turn is given: lower checks.totalTimeoutSeconds in ${files.settings} or waitSeconds in ${files.reviewers}.`,
          },
        ]
  }

  private writer(project: Project): Finding[] {
    const writer = project.readableDeclaration()?.writer ?? null
    const skill = project.cardSkill()

    if (writer === null) return []

    const named = writer.model === null ? writer.runtime : `${writer.runtime} on ${writer.model}`
    const starts: Finding =
      this.executions.find(writer.runtime)?.isAvailable() === true
        ? { state: 'ok', text: `The writer ${named} starts` }
        : { state: 'problem', text: `${named} writes the cards here, and the ${writer.runtime} command does not start: flags stay raw.` }

    if (skill === null) return [starts]

    return [
      starts,
      skill.exists
        ? { state: 'ok', text: `The card skill: ${skill.path}` }
        : { state: 'problem', text: `${skill.path} is missing, and the writer is pointed to it. Run weaver install to write a template.` },
    ]
  }

  // Nothing is said of a registry that is not there yet: nothing was flagged, and reading creates nothing.
  private cards(project: Project): Finding[] {
    try {
      const waiting = this.waiting(project)

      if (waiting === null) return []

      const raw = waiting.filter((card) => card.state === 'raw').length

      return [
        { state: 'ok', text: `The registry: ${new Counted(waiting.length, 'card waits', 'cards wait').text} for you` },
        ...(raw > 0 && this.lacksWriter(project) ? [this.unwritten(raw, project)] : []),
      ]
    } catch (error) {
      if (error instanceof RegistryError) return [{ state: 'problem', text: this.sentence(error.message) }]

      throw error
    }
  }

  private waiting(project: Project): Card[] | null {
    const registry = project.recordedRegistry()

    try {
      return registry?.list() ?? null
    } finally {
      registry?.close()
    }
  }

  private unwritten(flags: number, project: Project): Finding {
    return {
      state: 'note',
      text: `${new Counted(flags, 'flag waits', 'flags wait').text} and no writer is declared: a flag stays raw without one. ${project.configName}/${DeclarationParts.FILES.writer} says who writes the cards.`,
    }
  }

  // A declaration that cannot be read does not say whether it names a writer.
  private lacksWriter(project: Project): boolean {
    try {
      return (project.declaration()?.writer ?? null) === null
    } catch {
      return false
    }
  }

  // Maintenance lasts until the owner turns it off: a session left in it is said here.
  private maintenance(project: Project): Finding[] {
    return new RepositorySessions(project.repository).underMaintenance().map((session) => ({
      state: 'note',
      text: `The session ${session.shortId} (${session.agent}) is in maintenance: the guards of the project let its calls through. weaver maintenance off ${session.shortId} puts them back.`,
    }))
  }

  private hook(): Finding {
    return this.link.isAlive()
      ? { state: 'ok', text: `The hook starts: ${this.link.hook}` }
      : { state: 'problem', text: `The hook does not start: ${this.link.hook}. Build Weaver with pnpm build.` }
  }

  private runtime(runtime: RuntimeSettings): Finding {
    const wiring = runtime.wiring()

    if (wiring === 'installed') return { state: 'ok', text: `${runtime.label}: wired in ${runtime.file}` }
    if (wiring === 'absent') return { state: 'note', text: `${runtime.label}: not wired` }

    const wired = runtime.wiredTag()
    const own = new OwnRelease()
    const whose =
      wired === null || wired === own.tag ? 'are not the ones this Weaver writes' : `are those of Weaver ${wired}, and this is ${own.tag}`

    return { state: 'problem', text: `${runtime.label}: the hooks in ${runtime.file} ${whose}. Run weaver update.` }
  }

  // An agent learns how to work under Weaver from the guide its runtime lists: one that says what an earlier Weaver
  // did, or what the project declared before, misleads it.
  private guide(project: Project, runtime: RuntimeSettings): Finding[] {
    const guide = runtime.wiring() === 'absent' ? null : project.guide(runtime.guide)

    if (guide === null) return []

    const { hidingGuide } = runtime

    if (hidingGuide !== null && existsSync(hidingGuide)) {
      return [
        {
          state: 'problem',
          text: `${runtime.label}: the personal skill ${hidingGuide} has the name of the guide, and ${runtime.label} reads it in its place. Rename it.`,
        },
      ]
    }

    const state = guide.state()

    if (state === 'current') return [{ state: 'ok', text: `${runtime.label}: the guide of Weaver in ${guide.path}` }]

    const texts: Readonly<Record<Exclude<typeof state, 'current'>, string>> = {
      absent: `${runtime.label}: no guide of Weaver in ${guide.path}, which tells its agents how to work here. Run weaver update.`,
      foreign: `${runtime.label}: ${guide.path} is a skill named weaver that Weaver did not write, so its agents get no guide. Rename that skill, then run weaver update.`,
      stale: `${runtime.label}: the guide in ${guide.path} is not the one of this Weaver and this configuration. Run weaver update.`,
    }

    return [{ state: 'problem', text: texts[state] }]
  }

  // Without the mod, the end of a task says nothing in the chat while it runs: only `weaver status` tells where it is.
  private mod(project: Project, runtime: RuntimeSettings): Finding[] {
    if (runtime.mod === null || runtime.wiring() === 'absent') return []

    const mod = new StatusMod(project.top, runtime.mod)
    const state = mod.state()

    if (state === 'current')
      return [{ state: 'ok', text: `${runtime.label}: the end of a task shown in its chat, by the mod in ${mod.path}` }]

    const texts: Readonly<Record<Exclude<typeof state, 'current'>, string>> = {
      absent: `${runtime.label}: no mod in ${mod.path} to show the end of a task in its chat. Run weaver update.`,
      foreign: `${runtime.label}: ${mod.path} is a folder Weaver did not write, so the end of a task is not shown in its chat. Rename it, then run weaver update.`,
      stale: `${runtime.label}: the mod in ${mod.path} is not the one of this Weaver. Run weaver update.`,
    }

    return [{ state: 'note', text: texts[state] }]
  }

  // A runtime may hold hooks and not run them, without a word: it alone says. Nothing is said of a runtime that has
  // no way to say, nor of one that does not start, which has no session to supervise.
  private async held(runtime: RuntimeSettings, top: string): Promise<Finding[]> {
    const execution = this.executions.find(runtime.runtime)

    if (execution === null || runtime.wiring() !== 'installed') return []

    const answer = await execution.hooks(top)

    if (answer === null) return []
    if (answer.failure === null) return this.standing(runtime, answer.hooks)

    return execution.isAvailable()
      ? [{ state: 'note', text: `${runtime.label} did not say whether it runs these hooks: ${answer.failure}` }]
      : []
  }

  private standing(runtime: RuntimeSettings, hooks: readonly RuntimeHook[]): Finding[] {
    const { label } = runtime
    const wired = runtime.commands()
    const held = hooks.filter((hook) => wired.includes(hook.command))
    const some = (count: number): string =>
      count === wired.length ? 'these hooks' : `${String(count)} of these ${String(wired.length)} hooks`
    const waiting = held.filter((hook) => hook.standing === 'waits').length
    const off = held.filter((hook) => hook.standing === 'off').length

    if (held.length === 0) {
      return [
        {
          state: 'problem',
          text: `${label} does not load these hooks: it works in this project without Weaver. It loads the hooks of a project it trusts: it asks when it is first opened in the folder, and keeps the answer in its own configuration.`,
        },
      ]
    }

    const problems = [
      ...(held.length < wired.length ? [`${label} loads only ${some(held.length)}: /hooks, in ${label}, shows the ones it holds.`] : []),
      ...(waiting > 0
        ? [
            `${label} does not run ${some(waiting)} until you approve them, and asks again whenever one changes: open ${label} in this folder and approve them with /hooks.`,
          ]
        : []),
      ...(off > 0 ? [`${label} holds ${some(off)} turned off: turn them on there with /hooks.`] : []),
    ]

    return problems.length === 0
      ? [{ state: 'ok', text: `${label} runs these hooks` }]
      : problems.map((problem): Finding => ({ state: 'problem', text: problem }))
  }

  // With no runtime wired, no agent calls Weaver: nothing is refused and nothing is checked, without a word.
  private anyRuntime(runtimes: readonly RuntimeSettings[]): Finding {
    return runtimes.some((runtime) => runtime.wiring() !== 'absent')
      ? { state: 'note', text: 'An agent started outside these runtimes is not supervised' }
      : { state: 'problem', text: 'No agent runtime is wired: agents work here unsupervised. Run weaver install.' }
  }
}

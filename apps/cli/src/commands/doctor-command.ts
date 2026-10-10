import type { EngineLink } from '../link/engine-link.ts'
import type { Output } from '../output/output.ts'
import { Project } from '../project/project.ts'
import { RuntimeCatalog } from '../runtimes/runtime-catalog.ts'
import type { RuntimeSettings } from '../runtimes/runtime-settings.ts'
import type { Command } from './command.ts'

interface Finding {
  readonly state: 'ok' | 'problem' | 'note'
  readonly text: string
}

const MARKS = { ok: 'ok     ', problem: 'PROBLEM', note: '-      ' }

export class DoctorCommand implements Command {
  readonly name = 'doctor'
  readonly usage = 'doctor'
  readonly summary = 'Check that Weaver is alive in this project: its configuration, its hook, and each agent runtime.'
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink

  constructor(cwd: string, output: Output, link: EngineLink) {
    this.cwd = cwd
    this.output = output
    this.link = link
  }

  run(): number {
    const project = Project.locate(this.cwd)
    const runtimes = new RuntimeCatalog().settings(project.top, this.link, [])
    const findings = [
      this.configuration(project),
      ...this.finishSkill(project),
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
        return { state: 'problem', text: `no ${project.configName}: Weaver does nothing in this project. Run weaver install.` }
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
            text: `${skill.path} does not show ${missing.map((heading) => `## ${heading}`).join(', ')}, which the configuration waits for.`,
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

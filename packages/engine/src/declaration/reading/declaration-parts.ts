import { Declaration } from '../content/declaration.ts'
import type { DeclaredCheck } from '../content/declared-check.ts'
import type { DeclaredGuard } from '../content/declared-guard.ts'
import { FinishPolicy } from '../content/finish-policy.ts'
import { ReviewPolicy, type ReviewerName, type ReviewerSettings } from '../content/review-policy.ts'
import { GateRule } from '../rules/gate-rule.ts'
import { HumanRule } from '../rules/human-rule.ts'
import { LlmRule } from '../rules/llm-rule.ts'
import type { Rule } from '../rules/rule.ts'
import type {
  ChecksDocument,
  DocumentCheckRule,
  DocumentReviewRule,
  GuardsDocument,
  PartName,
  ReviewersDocument,
  RulesDocument,
  ScriptsDocument,
  SettingsDocument,
} from '../schema/declaration-document.ts'
import { frontMatter } from '../../lib/text/front-matter.ts'
import { PartSchema } from '../schema/part-schema.ts'
import { DeclarationError } from './declaration-error.ts'

// The text of each file of a declaration that exists, by the part it holds.
export type PartTexts = Readonly<Partial<Record<PartName, string>>>

// Reads a file of the project by its path from the root of the repository; null when it is not there.
export type ProjectFile = (path: string) => string | null

// What a project declares, as the files it wrote: each is read against its own schema, then they are put together.
export class DeclarationParts {
  // Where each part is written, inside the folder of the declaration.
  static readonly FILES: Readonly<Record<PartName, string>> = {
    settings: 'settings.json',
    guards: 'project/guards.json',
    checks: 'project/checks.json',
    scripts: 'project/scripts.json',
    reviewers: 'llm/reviewers.json',
    rules: 'llm/rules.json',
  }

  private readonly where: string
  private readonly texts: PartTexts
  private readonly read: ProjectFile
  private readonly problems: string[] = []

  constructor(where: string, texts: PartTexts, read: ProjectFile = () => null) {
    this.where = where
    this.texts = texts
    this.read = read
  }

  declaration(): Declaration {
    const settings = this.part<SettingsDocument>('settings', { version: 1 })
    const guardsOf = this.part<GuardsDocument>('guards', {})
    const checksOf = this.part<ChecksDocument>('checks', {})
    const scripts = this.part<ScriptsDocument>('scripts', {})
    const reviewers = this.texts.reviewers === undefined ? null : this.part<ReviewersDocument>('reviewers', {})
    const rulesOf = this.part<RulesDocument>('rules', {})

    this.failOnProblems()

    const checks = Object.entries(checksOf).map(([id, check]): DeclaredCheck => ({
      id,
      verify: check.verify,
      fix: check.fix ?? null,
      cwd: check.cwd,
      when: check.when ?? null,
      reads: check.reads,
      timeoutSeconds: check.timeoutSeconds,
      after: check.after ?? null,
    }))
    const rules = [
      ...Object.entries(checksOf).flatMap(([check, { rules: own }]) =>
        Object.entries(own).map(([id, rule]) => this.checkRule(id, check, rule)),
      ),
      ...Object.entries(rulesOf).map(([id, rule]) => this.reviewRule(id, rule)),
    ]
    const guards = Object.entries(guardsOf).map(([id, guard]): DeclaredGuard => ({ ...guard, id }))
    const { finish } = settings
    const headings = this.headings(finish.skill)

    this.problems.push(...this.bindingProblems(checks, guards, rules, reviewers !== null))
    this.failOnProblems()

    return new Declaration({
      exclude: scripts.scope.exclude,
      finish: new FinishPolicy({ ...finish, headings, skill: finish.skill ?? null }),
      review: reviewers === null ? null : this.reviewPolicy(reviewers),
      scripts: { writers: scripts.writers, readers: scripts.readers },
      checks,
      guards,
      rules,
    })
  }

  // A part that was not written is read as an empty one, so that it comes out with the defaults of its schema.
  private part<Shape>(name: PartName, empty: object): Shape {
    const file = DeclarationParts.FILES[name]
    const schema = new PartSchema(name)
    const value = this.json(file, this.texts[name]) ?? empty

    if (!schema.accepts(value)) this.problems.push(...schema.problems.map((problem) => `${file}: ${problem}`))

    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema')) as Shape
  }

  private json(file: string, text: string | undefined): unknown {
    if (text === undefined) return undefined

    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      this.problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)

      return undefined
    }
  }

  private failOnProblems(): void {
    if (this.problems.length > 0) throw new DeclarationError(this.where, this.problems)
  }

  // Where a rule is written says who settles it: a program when it is in a check, a reviewer when it is in the review.
  private checkRule(id: string, check: string, rule: DocumentCheckRule): Rule {
    const { statement, level } = typeof rule === 'string' ? { statement: rule, level: 'gate' as const } : rule
    const fields = { id, statement, scope: null, check, evidence: false }

    return level === 'human' ? new HumanRule(fields) : new GateRule(fields)
  }

  private reviewRule(id: string, rule: DocumentReviewRule): Rule {
    const said = typeof rule === 'string' ? { statement: rule, evidence: false } : rule

    return new LlmRule({
      id,
      statement: said.statement,
      scope: said.scope ?? null,
      check: said.candidates ?? null,
      evidence: said.evidence,
    })
  }

  private reviewPolicy(review: ReviewersDocument): ReviewPolicy {
    const settings = (name: ReviewerName): ReviewerSettings => ({
      model: review.reviewers[name]?.model ?? null,
      effort: review.reviewers[name]?.effort ?? null,
    })

    return new ReviewPolicy({
      runtime: review.runtime,
      reviewers: { claude: settings('claude'), codex: settings('codex') },
      criticalPaths: review.critical.paths,
      criticalLines: review.critical.lines ?? null,
      experiments: review.experiments,
      timeoutSeconds: review.timeoutSeconds,
      waitSeconds: review.waitSeconds,
      maxRounds: review.maxRounds,
      skill: review.skill ?? null,
      issue: review.issue ?? null,
    })
  }

  // The headings of the final message are written once, in the skill that teaches them to the agent. A skill that is
  // not there yet teaches nothing: the doctor says so, and every end of turn ends the task meanwhile.
  private headings(skill: string | undefined): readonly string[] | null {
    const text = skill === undefined ? null : this.read(skill)
    const listed = text === null ? undefined : frontMatter(text).headings

    if (skill === undefined || text === null) return null
    if (listed !== undefined && typeof listed !== 'string' && listed.length > 0 && listed.every((heading) => heading !== '')) return listed

    this.problems.push(`${skill}: its header lists no \`headings\`: they are what tells Weaver that a task is finished`)

    return null
  }

  // A schema describes the shape of each entry, not what ties one entry to another.
  private bindingProblems(
    checks: readonly DeclaredCheck[],
    guards: readonly DeclaredGuard[],
    rules: readonly Rule[],
    reviewed: boolean,
  ): string[] {
    const files = DeclarationParts.FILES
    const known = new Set(checks.map((check) => check.id))
    const behind = new Set(rules.flatMap((rule) => rule.check ?? []))
    const judged = rules.filter((rule) => rule.level === 'llm')
    const twice = [...new Set(rules.map((rule) => rule.id).filter((id, index, ids) => ids.indexOf(id) !== index))]

    return [
      ...twice.map((id) => `the rule ${id} is written twice: a name stands for one rule in the whole project`),
      ...(judged.length > 0 && !reviewed ? [`${files.rules} holds rules, and ${files.reviewers} is not there to say who reviews`] : []),
      ...judged.flatMap((rule) => this.candidatesProblem(rule, checks)),
      ...guards.flatMap((guard) =>
        guard.writes.length + guard.runs.length === 0 ? [`${files.guards}: ${guard.id} refuses nothing: it needs writes or runs`] : [],
      ),
      ...checks.flatMap((check) => {
        if (!behind.has(check.id)) {
          return [
            `${files.checks}: ${check.id} stands behind no rule: give it rules, or name it as the candidates of a rule of ${files.rules}`,
          ]
        }
        if (check.after !== null && !known.has(check.after))
          return [`${files.checks}: ${check.id}.after names ${check.after}, which is not a check`]

        return []
      }),
    ]
  }

  private candidatesProblem(rule: Rule, checks: readonly DeclaredCheck[]): string[] {
    const file = DeclarationParts.FILES.rules
    const lister = checks.find((check) => check.id === rule.check)

    if (rule.check === null) return []
    if (lister === undefined) return [`${file}: ${rule.id}.candidates names ${rule.check}, which is not a check`]

    return lister.reads === 'findings'
      ? []
      : [
          `${file}: ${rule.id}.candidates names ${lister.id}, which reads ${lister.reads}: a check that lists places for the reviewer reads findings`,
        ]
  }
}

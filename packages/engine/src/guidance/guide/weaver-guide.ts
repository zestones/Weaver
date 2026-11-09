import { FlagText, NoteText } from '@weaver/memory'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { DeclaredCheck } from '../../declaration/content/declared-check.ts'
import type { DeclaredGuard } from '../../declaration/content/declared-guard.ts'
import { OwnerCommandGuard } from '../../guards/kinds/owner-command-guard.ts'

const SECONDS_IN_A_MINUTE = 60

// How an agent works under Weaver in one project: what Weaver does around it, its commands and when to use them,
// and what is the owner's. It is Weaver's knowledge, written with what the project declares: `weaver guide` prints
// it, and the runtimes read it as a skill. What Weaver tells an agent at one moment says only what that moment needs.
export class WeaverGuide {
  // What the guide is for, in the words that make an agent open it.
  static readonly SUMMARY =
    'How to work in this repository under Weaver, which supervises its coding agents: what Weaver does around your calls, its commands and when to use them, and what is the owner’s alone. Read it at the start of a task, when Weaver names cards on files you changed, when the owner names a card, when you find something your task does not settle, before you end a task that changed files, and when Weaver refuses a call or answers in place of a command.'

  private readonly declaration: Declaration

  constructor(declaration: Declaration) {
    this.declaration = declaration
  }

  get text(): string {
    return [
      '# Working under Weaver',
      'Weaver supervises the coding agents of this repository through the hooks of their runtime. It sees each of your tool calls and the files they change, refuses what the project forbids, checks your work when your task ends, may have another agent review it, and keeps for the owner, as cards, what agents find along the way. The owner decides; you work, and you write what you did where the owner reads it. `weaver guide` prints this guide as it stands for this project.',
      this.course(),
      this.cardsOnChanges(),
      this.whileWorking(),
      this.onCard(),
      this.ending(),
      ...(this.declaration.review === null ? [] : ['Reviewers obey the project’s command guards, as the agent does.']),
      'When Weaver reports that a later release is installed, tell the owner to run `weaver update` in this project after active agents finish. The notice is given once per session.',
      this.owners(),
      ...this.guards(),
    ].join('\n\n')
  }

  private course(): string {
    return [
      '## How a task goes',
      '',
      '1. Each request of the owner opens a unit of work: the files your calls change. That is what Weaver checks and reviews, not the rest of the tree.',
      'Attribution covers regular files and respects scripts.scope.exclude. Symlinks and special files are left out; unavailable paths are counted in a hook warning.',
      'If a hook fails, tell the owner and run `weaver doctor`; its message names the journal. A failure at the end of a task is also delivered with the next request or tool result. `weaver status` and `weaver doctor` show hook errors from the last seven days.',
      '2. A guard may refuse a call before it runs, and says why. Do what the reason says, or tell the owner what you need: never go around a guard.',
      '3. After a call that changed files, a check may warn you of what would hold the end of your task: fix it then.',
      `4. When your final message ${this.declaration.finish.headings === null ? 'ends your turn' : 'carries the sections of the project'}, the checks of the project run on your unit of work${this.declaration.review === null ? '' : ', then a reviewer may read it'}. A failure${this.declaration.review === null ? '' : ', or a finding,'} sends you back to work.`,
    ].join('\n')
  }

  private cardsOnChanges(): string {
    return [
      '## Cards on files you change',
      '',
      'After a call changes a file, Weaver injects the open cards on that file, once per card per unit, and stays silent when none match. Read named cards with `weaver cards <number>...`; search with `weaver cards --search <words>` when useful. What a card already says is not to be found again, and your change may settle it.',
    ].join('\n')
  }

  private whileWorking(): string {
    return [
      '## While you work',
      '',
      '### Hear a check before the end',
      '',
      'When your task ends, Weaver runs the checks of the project on what you changed, and a failure sends you back. `weaver check <name>...` runs some of them now, on your unit of work, as the end of the task will, without ending it and without counting as a refusal; `weaver check` alone runs all of them. A check runs after the one it waits for. Run a long one in the background if your runtime can, and go on meanwhile. A check that reads nothing changed since it ran gives its verdict again at the end, without running. An explicit `weaver check` always reruns the selected checks. If Weaver state is read-only, it reports the verdict without recording it and says so.',
      '',
      ...this.checks(),
      '',
      '### Investigate, fix and document what you find',
      '',
      'When you discover a problem, investigate and fix it if it needs no owner decision and lies within your task’s reach, then document it. Flag what you found and did: a defect or a risk in code your task did not write, a debt, a choice that is theirs. Flag it even when the request led you to it, and even when you also speak of it in your final message: that message is read once, and a flag waits until the owner decides. A flag changes no file, so make it in a task that only reads too. Do not flag a matter of taste, what a linter catches, nor what the owner only has to check in your own change.',
      '',
      '```text',
      FlagText.FORMAT,
      '```',
      '',
      'Run the command with your shell tool, as it is written. Weaver takes the call before it runs and answers in its place with the number of the flag: that answer is expected, not a failure, so do not run the command again. Name the flag by its number in your final message. When a problem needs no owner decision and is within your task’s reach, investigate, fix and verify it, then flag it with `Decision: none` and `Did: fixed in the task`, or write investigation and fixed notes on an existing card. If it needs a choice from the owner, write `Decision: owner <the question>` and leave that choice explicit. Missing decisions on older flags are unknown. The writer may suggest a decision only for unknowns; it cannot replace an explicit owner decision.',
    ].join('\n')
  }

  private checks(): string[] {
    const { checks } = this.declaration

    if (checks.length === 0)
      return [
        'This project declares no check. Tasks still settle, but nothing was checked: tell the owner that the work has no automated validation. Checks are configured in `.weaver/project/checks.json`.',
      ]

    return ['The checks of this project:', '', ...checks.map((check) => `- ${this.check(check)}`)]
  }

  private check(check: DeclaredCheck): string {
    const when = check.when === null ? 'on any change' : `when a file of ${check.when.map((glob) => `\`${glob}\``).join(', ')} changed`
    const after = check.after === null ? '' : `, after \`${check.after}\``
    const minutes = Math.ceil(check.timeoutSeconds / SECONDS_IN_A_MINUTE)

    return `\`${check.id}\`: runs ${when}${after}; it may take up to ${String(minutes)} min.`
  }

  private onCard(): string {
    return [
      '## When your task is about a card',
      '',
      '1. Read it: `weaver cards <number>`.',
      '2. Look at its neighbours: `weaver cards --file <path>` on each of its files, and `weaver cards --search <words>`. One cause is often written on several cards.',
      '3. Investigate, then write on the card what you ran, what you read, and what it shows.',
      '4. When your task is to fix it, fix it, then write on the card what you changed, how you verified it, and what is left.',
      '',
      'Write the same on each neighbour your work settled or advanced. A fix is refused on a card where nothing yet says what was looked into: write the investigation first; both may go in one call, in that order. Weaver answers in place of the command, as for a flag.',
      '',
      '```text',
      NoteText.FORMAT,
      '```',
      '',
      'At task end Weaver asks once per unit to resolve at most two actionable cards on files the unit changed, within about ten minutes, and document each with notes. These cards have short shared claims so parallel agents do not take the same work; stop when the claim expires. Raw flags with no owner decision may be included. If a card is out of reach, write `weaver note <number> deferred <reason>` and name it and the reason in your final message; it stays open. Pending owner decisions are left explicit. The same prompt asks for notes on other cards whose files changed. Reading a card, flagging it in this unit, or writing any note (including free text) creates no note hold. Weaver never adds a second card hold in the unit.',
    ].join('\n')
  }

  private ending(): string {
    const { finish, review } = this.declaration
    const headings = finish.headings ?? []
    const skill = finish.skill === null ? '' : ` How to write them: \`${finish.skill}\`.`

    return [
      '## When you end a task',
      '',
      headings.length === 0
        ? 'This project names no final sections: each end of a turn ends the task, and its checks run then.'
        : `A task that changed files ends with a final message made of these sections, in this order: ${headings.map((heading) => `\`## ${heading}\``).join(', ')}.${skill} Their headings tell Weaver the work is finished: only then do the checks run. A message without them, a question or a progress update, leaves the work open.`,
      '',
      '- When the checks fail, fix each failure, then end again the same way.',
      ...(review === null
        ? []
        : [
            '- When a reviewer finds points, numbered F1, F2 and so on, fix each one or decide to leave it, and answer each in your final message, one line each: `F1 fixed: <what you changed>`, naming the file when the fix is in another file than the point, or `F1 not fixed: <why>`. Every answer is kept before Weaver decides whether extra work requires another review; that review receives the prior answers.',
          ]),
      '- The check refusal allowance belongs to the unit across requests. After it is exhausted, unchanged inputs are not checked again: failures are left to the owner and you may stop. An owner request containing #check asks for fresh judgement, or run `weaver check` explicitly. Changed inputs are still judged; they do not reset the allowance. Reports put new validation items first and count previously listed items separately.',
      '- While a command or a watch you sent to the background runs, you may stop without ending the task: your runtime wakes you when it ends.',
    ].join('\n')
  }

  private owners(): string {
    return [
      '## Card changes and closing proposals',
      '',
      'Agents and owners may use `weaver cards tie <a> <b> [reason]`, `weaver cards untie <a> <b>`, `weaver cards separate <number>`, `weaver cards reopen <number> [reason]`, `weaver cards retitle <number> <title>`, `weaver cards label <number> <family:value>`, and `weaver cards rewrite <number>` (Markdown on stdin). Every change records its actor. Retitles, labels and rewrites retain their before and after content: inspect it with `weaver cards revisions <number>`, and restore with `weaver cards restore <number> <revision> [reason]`. Reopening starts a new resolution cycle and keeps the previous closing in history.',
      '',
      'Codex is the default card writer. It catches up raw flags in bounded batches on requests and at turn end. Use `weaver cards write --batches 4` for deliberate catch-up, and `--retry-failed` only when the cause of failed writing has been addressed. The owner can disable it with `enabled: false` in the writer declaration.',
      'Reviews that finish after their wait, and findings of the final review, are kept as cards even if the original session disappears. A later request or tool result names the cards in additional context. This notice does not add a refusal.',
      'Resolution is uninvestigated, investigated, fixed, refuted, deferred or needs-owner. Use `weaver note <number> needs-owner <question>` for a concrete owner decision; use `weaver note <number> no-decision <reason>` when no owner decision is needed. Investigation alone does not clear an explicit owner question. Fixed means reported fixed. A latest fixed or refuted conclusion on an open card produces a deterministic closing proposal from its notes, including existing notes. It records cause, fix, verification and remaining work. Missing verification says "verification not run" with a warning; the owner can still accept it. Raw flags still wait for the writer.',
      '',
      'The list distinguishes actionable cards, unknown decisions, deferred cards, cards needing the owner and proposals for closing. Read the full proposal with `weaver cards <number>`. Only the owner accepts it, with `weaver close <number>`, or supplies a disposition with `weaver close <number> fixed|wontfix|issue|invalid [reason]`. A changed card makes a previously shown proposal stale: read it again before accepting. In `weaver ui`, agents can read, note and label; only the owner closes. The c key accepts a proposal in one gesture and C opens the closing form. Issue bodies expand related problems without local card numbers. After checking the tracker for an interrupted filing, use `weaver cards issue-result <number> <url|not-filed>` to reconcile it before the owner retries closure.',
      '',
      '## What is the owner’s',
      '',
      `These commands close a card, plug Weaver in or out, or lift its guards: they refuse to run under an agent. ${OwnerCommandGuard.COMMANDS.map((command) => `\`weaver ${command}\``).join(', ')}. When one is needed, say so in your final message: the owner runs it.`,
      '',
      'The configuration of Weaver under `.weaver/`, its state under `.git/weaver/` and the hooks of the runtimes are the owner’s too: describe the change you need instead of making it.',
    ].join('\n')
  }

  private guards(): string[] {
    const { guards } = this.declaration

    if (guards.length === 0) return []

    return [['## The guards of this project', '', ...guards.map((guard) => `- ${this.guard(guard)}`)].join('\n')]
  }

  private guard(guard: DeclaredGuard): string {
    const held = [...guard.writes.map((glob) => `writing \`${glob}\``), ...guard.runs.map((command) => `running \`${command}\``)]

    return `\`${guard.id}\` refuses ${held.join(', ')}: ${guard.statement}`
  }
}

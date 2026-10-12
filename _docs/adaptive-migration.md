# Moving Adaptive from its harness to Weaver

Where the move stands, written for the owner: what is left to do, what was done, what was verified, what Weaver does not do that the harness did, and the choices that were made without asking.

The work is in the clone, `~/Documents/Github/others/Adaptive-Runtime-Intelligence-for-Industrial-Assets`, on its branch `631-…`. You committed it there as `54d486a74` on 2026-10-12, with the patch for the CI workflows and the agent settings applied, and ran `weaver install`: `weaver doctor` finds Claude Code and Codex wired to Weaver 0.1.0. One change came afterwards and is not committed: three repairs in `.weaver/project/checks.json`. The real repository, under `zestones/`, was only read.

## What you have to do

1. **Commit the three repairs** in the clone, where `.weaver/project/checks.json` is the only file changed: `chore(weaver): repair lint, API types and catalogs before the checks judge`.

2. **Decide the choices listed at the end of this file.** Each one can be reversed.

3. **Move the clone to the next release of Weaver**, once you have published it. Install it with the three commands of its notes, since 0.1.0 has no `weaver update`, then run `weaver update` in the clone: it applies the migration `0002-check-commands` to `.weaver/` (`fix` becomes `repair`, `verify` becomes `judge`, `checks.warnTimeoutSeconds` is added) and wires the hooks again. Until then the clone stays on 0.1.0, which is still installed beside it. After the move, the checks that are fast on one file can declare a `warn`: the lint, the ast-grep rules, the name and the place of a new file, the backend lint. Their scripts are not written.

4. **Try a real task that touches the backend.** Only two of the nine backend families ran here, and the clone has neither the API's Python environment nor the docs toolchain.

5. **Bring it to the real repository**, when no agent session works there:
   - take the harness's memory again, with the two commands of `legacy/about/copy.md`: it went on writing after the first copy;
   - merge, then run `weaver install` there;
   - `.git/gates` can go once you no longer want it in place: `legacy/memory/` holds the copy.

6. **In this repository**, commit the three files that ignore `legacy/`: `chore: ignore legacy/, the local copy of the harness Weaver rewrites`.

## What was done in the clone

| What                | Detail                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Removed             | `tools/agents`, `docs/harness`, `ci-agents.yml`, `.codex/hooks.json`, `.codex/rules/agents.rules`, the four git hooks that journaled for the harness, the `harness-triage` skill |
| `.weaver/`          | 23 checks standing behind 123 rules, 22 rules for the reviewer, 6 guards, the reviewer, the writer, the labels, the issue command, three skills                                  |
| `tools/weaver/`     | 12 scripts under `checks/`, what they share under `lib/`, 101 tests under `test/`                                                                                                |
| `tools/ci/commits/` | the refusal of a ref update made by an agent stands alone (`actor.sh`), the commit checks describe their rules in their own header                                               |
| Guides              | `backend-review.md` and `backend-checks.md` moved from `docs/harness/guides/` to `docs/contributing/`, with the sentences about the harness rewritten                            |
| Instructions        | section 5 of `AGENTS.md` rewritten for Weaver, `issue-fix` and `issue-review` updated, a `card-triage` skill in place of `harness-triage`                                        |
| Links and mentions  | every link into the deleted folders repaired; the notes of the ast-grep rules, two READMEs and three guides no longer name the harness                                           |

### How a rule of the old catalog became a rule of Weaver

`RULES.md` is gone with `tools/agents`. Its sentences now live in `.weaver/`, each written where it is enforced:

- a rule a program judges is under its check, in `project/checks.json`;
- a rule the reviewer judges is in `llm/rules.json`;
- an action that is refused before it runs is a guard, in `project/guards.json`.

Rules have readable names (`kebab-case-file-names`, `no-floating-promises`). The scripts of the project still print the old codes (`N1`, `B7-free-function`): the command line of each check, in `checks.json`, says which name each code takes (`N1=kebab-case-file-names`), and `tools/weaver/lib/rule-names.mjs` applies it. A backend code keeps its variant in the message: `[B7-free-function] …`.

Fifteen rules are of level `human`: a finding is listed for you and does not hold the agent. They carry `-flagged` in their name, except `mutation-retry-optimistic`.

The rules that are not in `.weaver/`, because Weaver is not what enforces them:

- the commit rules (size of a commit, one-line message, move then change, a test with a fix): the git hooks and the `commits` job of CI;
- secrets in the code, and the global coverage floor: CI;
- the three headings of the final message: the finish skill, which Weaver reads.

### The checks

| Check                                            | What it runs                                                                                        | Verdict  | Ran for real here       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| `client-format`                                  | Prettier, repair then check, on the changed client files                                            | exit     | yes                     |
| `client-types`                                   | `tsc` on the three projects, through `whole-project.mjs`                                            | exit     | yes                     |
| `client-lint`                                    | ESLint repairs what it can, then `eslint .` through `whole-project.mjs`; 50 rules                   | exit     | yes, 48 s               |
| `client-unused`, `client-cycles`                 | knip, dependency-cruiser, through `whole-project.mjs`                                               | exit     | yes                     |
| `client-tests`, then `client-coverage`           | the tests related to the change, then 80 % of the changed lines and branches                        | exit     | yes, 41 s               |
| `client-i18n`                                    | the catalogs are extracted again, then must be current and compile strictly                         | exit     | yes                     |
| `client-api-types`, `client-design-tokens`       | the API types are generated again; then both generators with `--check`, through `whole-project.mjs` | exit     | yes                     |
| `client-build`                                   | `vite build`, then the bundle budget, the CSP contract and the i18n build check                     | findings | yes, 8 s                |
| `client-duplication`                             | jscpd against a baseline taken on the base of the unit                                              | exit     | yes                     |
| `client-ast-grep`, `-naming`, `-folders`         | the client's own diff scripts, through `diff-check.mjs`                                             | findings | yes                     |
| `client-test-counts`, `-comments`, `-assertions` | the same; comments and assertions list places for the reviewer                                      | findings | yes                     |
| `markdown`                                       | `check-markdown.mjs`, through `diff-check.mjs`                                                      | findings | yes                     |
| `docs-build`                                     | `mkdocs build --strict`, compared with the base                                                     | findings | no: no `.venv-docs`     |
| `change-scan`                                    | suppressions, exclusions, instructions, dependencies, protected files                               | findings | yes                     |
| `backend`                                        | the nine families of the backend checker, three at a time                                           | findings | `ruff` and `house` only |
| `backend-evidence`                               | the lot record of the API migration                                                                 | exit     | yes                     |

A check that judges the whole client fails only for what the unit of work added: when it fails, `whole-project.mjs` runs the same command on the base of the unit and compares. This is the comparison with the base that Weaver itself does not have yet, done by the project, and for the client only.

### Repairs before the verdict

Four checks repair before they judge, so that what a program can fix never costs the agent a round: Prettier on the changed files, `eslint --fix` on them, the generation of the API types, the extraction of the catalogs. In the harness's journal, from 2026-09-29 to 2026-10-11, stale catalogs failed 4 ends of task out of 163 and stale API types 1. Weaver names in its report the files a repair rewrote, for the agent to read again.

## What was verified

- **The scripts**: 101 tests pass under Node 24 and Node 22. The tests of the commit checks (83 cases) and of the guide checks (11) pass.
- **The configuration**: `weaver doctor` reads it without a problem; its only complaints are the hooks, which `weaver install` writes.
- **The checks**: run for real as the table says, on a small temporary change in `src/lib/dates/hour-ticks.ts`, removed since.
- **Two real Claude sessions under Weaver** in the clone. The first created a guide: the final message was recognised, three checks ran, and two findings were listed under "To validate". The second, under the installed Weaver 0.1.0, changed a client source file and broke a blank-line rule on purpose: the repair put the line back, and the nineteen checks the change called for passed in one round. Both changes were removed.
- **The three repairs**: each was tried by breaking what it repairs (a blank line, the generated types, a translatable string), then running the repair and the check as declared. Both generators change nothing on a tree that is up to date.
- **The guards**: the hook was asked about 16 calls. The ten that a guard forbids were refused, with the sentence of the guard; the six others went through.

Not verified:

- **Seven backend families**: `types`, `architecture`, `sql`, `database`, `tests`, `contract`, `duplication`. The two that ran borrowed the Python environment of the real repository through a temporary link, removed since.
- **The docs build**, for lack of the toolchain in the clone.
- **Codex**, entirely.
- **A review and a card**: the trial session carried `#no-review` and flagged nothing.
- **`test_runtime_integrity.py`**, a backend test edited to stop importing the harness: read, not run.

## What Weaver does not do that the harness did

| What the harness did                                                    | What happens now                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linted a client file right after each edit, and the backend likewise    | Weaver can since 2026-10-12, in a change that is not released yet: a check may carry a `warn` command, run on the files a call just changed. The clone declares none so far, so nothing runs there before the end of the task.                                                  |
| Reminded the agent to regenerate the schema reference after a SQL edit  | No reminder: the `database` family fails at the end of the task while the reference is stale.                                                                                                                                                                                   |
| Refused `pkill` only when its pattern carried neither a path nor a port | `pkill` is refused whatever its pattern: a guard matches words, it does not reason.                                                                                                                                                                                             |
| Refused `docker run` of a database or broker image                      | Not refused. `docker compose -p` and the database servers by name still are.                                                                                                                                                                                                    |
| Refused a new file at the repository root                               | Not refused: `AGENTS.md` says where scratch goes.                                                                                                                                                                                                                               |
| Refused the creation of a file under `docs/contributing/`               | Not refused: it is listed for you at the end of the task.                                                                                                                                                                                                                       |
| Refused a finished message without a `Vérification :` line              | No program reads the line. The finish skill asks for it, and you read it.                                                                                                                                                                                                       |
| `#missed`, and its `Bug manqué` section                                 | No equivalent. A flag and its card are the nearest thing.                                                                                                                                                                                                                       |
| `harness check`, to run the gates in the middle of a task               | No equivalent: the checks run when the task ends.                                                                                                                                                                                                                               |
| `harness maintenance on`, to let one session edit protected files       | `weaver maintenance on`, since 2026-10-12 in a change that is not released yet. It lifts every guard of the project for the session, where the harness lifted only the one on its own files; the git hook that refuses a ref update made by an agent is not Weaver's and stays. |
| Gave the heavy gates two slots shared by every session                  | Each session runs three checks at once, without knowing of the others.                                                                                                                                                                                                          |
| Kept the verdicts of a gate for a pair of trees                         | I found nothing in Weaver that reuses a verdict: each end of task runs the checks again. Only what a check computed on the base of the unit is kept, by the scripts.                                                                                                            |
| A git wrapper and Codex's own rules, besides the hook                   | One layer, Weaver's hook, plus the git hook that refuses a ref update made by an agent.                                                                                                                                                                                         |
| The registry, its web page and what earlier reviews said about a file   | Cards, read with `weaver cards`. The workbench and the recall are not built. The old memory is not imported.                                                                                                                                                                    |
| Ran the client's change checks and the changed-line coverage in CI      | Gone from CI, as decided: they run at the end of an agent's task only.                                                                                                                                                                                                          |

Smaller differences, each inherited from how a guard or a check works:

- `git stash` without a word after it is not refused by the guard; the git hook refuses the ref update it makes.
- `git clean -n` is refused like `git clean`.
- `docker compose exec db psql -p 5432` is refused, because `-p` follows `compose` among the words.
- The design check no longer starts on a change of the Figma sources, since `platform/design/figma` is excluded from the checks.
- A test that only timed out runs again alone at once, not after the other checks, and its note is a printed line, not a finding for you.
- The regenerated schema reference is always listed for you as a protected file.
- An agent under Codex that clears `CODEX_CI` passes for the owner in the git hook.
- The time is one budget of 20 minutes for all the checks, as before; the backend's own limit for pytest, 30 minutes, is above it.
- `whole-project.mjs` kept two oddities of the harness: a command that dies without a word on both sides passes, and a finding of knip that only moved counts as new once the base fails too.

## Choices made without asking, yours to confirm

- **Rule names.** I chose the 145 names. The codes stay in the scripts and in the messages.
- **One `backend` check for the nine families.** A rule name is unique in a Weaver project and the families share their rules; nine checks would need nine sets of names. A finding says which family reported it.
- **`pkill` refused entirely**, stricter than before.
- **`B13`, the lot record, holds the agent.** The harness blocked on it, though the catalog called it `human`.
- **The 103 native denials of `.claude/settings.json` are kept.** The patch only removes the hooks and the variable that pointed at deleted files.
- **A small `tooling` job in CI**, in the patch: it runs the tests of the commit checks, of the guide checks and of `tools/weaver`. Without it nothing tests them.
- **The commit checks and the guide check stay**, as scripts of the project.
- **`.codex/rules/agents.rules` deleted**, and `.codex/hooks.json` ignored by git, since `weaver install` writes paths of this machine in it.
- **Two guides created under `docs/contributing/`**, which the old rules reserved for you.
- **No `$schema` in the `.weaver/` files**: the path would name this machine and the version of Weaver.
- **The reviewer**: the runtime that wrote the change, Opus or `gpt-6-astra` at effort `max`, the other runtime on the sensitive paths or above 200 lines, 30 minutes, one refusal. **The writer**: Claude, 5 minutes.
- **`labels.json` and `issues.json`.** Both are optional files of Weaver, there since the cards exist. I filled the first with the `type` and `area` labels of the GitHub repository, which the writer chooses among for a card, and the second with `gh issue create`, which `weaver close <number> issue` runs. Nothing files an issue by itself: only you run that command. Without the first file a card carries no label; without the second, closing a card as `issue` only records it.
- **`scripts.json`**: the generators are listed as writers; no reader is listed, which is the cautious side.
- **Edits in files agents may not write**: the notes of thirteen ast-grep rules, one of them reformatted by Prettier, a comment in `eslint/gates.js` and `eslint.config.js`, a message of `check-folders.mjs`, a stale comment at the end of `.gitattributes`, a dead entry in `check-markdown.mjs`.
- **Names in the git tooling**: `actor.sh`, `GATES_PROC_ROOT`, `TOOLING_RE`.

## What the trials left

- In the clone's `.git/weaver`: the state of the two trial sessions and of the session named `guard-trial`. The registry there already held one card from earlier trials.
- Nothing in the working tree.

## Where things are

| What                          | Where                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| The patch, applied since      | `.cache/agents/weaver-migration/owner.patch`, in the clone |
| The harness's code, as it was | `legacy/code/`, in this repository, ignored by git         |
| The harness's memory          | `legacy/memory/gates/`, taken on 2026-10-12 at 01:39       |
| The Weaver the clone will use | `~/.local/share/weaver/v0.1.0`, after `weaver install`     |

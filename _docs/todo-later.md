# To do later

Work that is understood and deliberately postponed. Each entry says what it is, why it waits, and what would make it urgent.

## Comparison with the base

**What.** A check that looks at the whole project, such as the compiler or the test suite, is judged against the project as it was before the unit of work: Weaver runs it on the base tree as well, and keeps only the failures the unit introduced.

**Why it matters.** Such a check runs in the working tree as it stands. It therefore reports everything that is wrong there, whoever wrote it. With two sessions in one folder, a session is refused its end of task because of what the other left broken. A project that carries old errors has the same problem with a single session. A check given a list of files (`{files}`) is not concerned: it only sees the unit's own files.

**Why it waits.** The owner works with one agent and its subagents, which share one unit of work, and with two sessions at most. Adaptive is clean today for types, lint and formatting. A session refused for another's error passes at its next end of task, once the other has fixed it.

**What would make it urgent.** Sessions that block each other often enough to get in the way, or a project with errors it cannot fix at once.

**Where to start.** The engine already builds the base tree of a unit (`unit-of-work/diff/base-tree.ts`). What is missing is a folder that holds this tree, where the check can run, and the comparison of its two results. The source harness does it in `gates/runner/baseline.ts`. Running several whole-project checks at once on one machine is a related subject, which it handles in `gates/runner/slots.ts`.

## Guards decided by a program

**What.** A guard names a script of the project instead of a list. Before a tool runs, Weaver hands the script what the agent is about to do, and the script answers that the call may go on, or that it is refused and why.

**Why it matters.** A list refuses what has a name: a command, a path. Some refusals depend on a detail of the call. `pkill vite` kills every such process on the machine, while `pkill -f "vite --port 5173"` aims at one. An edit of `package.json` is fine unless it changes the dependencies. `docker run postgres` starts a substitute database, `docker run node` does not. The reasoning that tells these apart is a rule of the project, so it cannot live in Weaver.

**Why it waits.** The lists cover four of the seven families of refusals of the source harness: writes to git, installs, nested agents and owned files. A script started before every tool call also costs time on each of them.

**What would make it urgent.** Declaring the three families the lists cannot express: killing processes by a broad pattern, starting a substitute stack, and working around the harness itself.

**Where to start.** A guard is a class of `guards/kinds/` that answers with a refusal or nothing; this one would run a process and read its answer, as a check does. The source harness holds the reasoning to move into scripts in `policy/rules/` (`kill.ts`, `stack.ts`, `harness.ts`) and in `policy/decision/edit-policy.ts`.

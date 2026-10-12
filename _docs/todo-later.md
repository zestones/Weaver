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

## The recall against regressions

**What.** When an agent is about to change code, Weaver tells it what the registry and the git history know of that code: the corrections and the decisions tied to the files it touches. The reviewer and the owner are told too. It is the second need the [memory](memory.md) was asked for, the first being to keep what agents discover.

**Why it matters.** An agent remembers nothing of the sessions before its own. It can undo a correction or a decision without knowing there was one, and the owner does not reread everything.

**Why it waits.** The owner deferred it on 2026-10-11. It is to be defined with the owner first, with real cards at hand, once the registry has been in use. Nothing of its design is decided.

**What would make it urgent.** A correction or a decision undone by an agent that had no way to know of it.

**Where to start.** The first idea started from git, at the line: when an agent changes lines that a commit of correction wrote, Weaver tells the agent, the reviewer and the owner. A review of the design showed where that breaks: a squash, a formatting commit, moved code, generated files, a fix that removes code, a regression that lands in another file. Adaptive has such a history: its commit `2331926a4` moves 852 files. What that review proposes instead is that the registry selects the decisions and the corrections tied to the files, and that git only adds hints. Three things are missing for that today. A closing as `wontfix` covers both "this is wanted" and "not now", and only the first should stop an agent. A correction made during a task is kept by its review, not by the registry. And Weaver does not keep the request of the owner once its unit of work is closed: what is not recorded cannot serve the recall later, so the journal has to start recording both before the recall is built. The source harness does its recall in `registry/knowledge/retrieval/` and in `history/`.

## Running the checks on demand

**What.** A command, `weaver check [name...]`, that runs the checks of the project on the unit of work in progress exactly as the end of the task would, with the same trees and the same environment, without ending the task, settling anything or counting as a refusal. An agent asks for one check while it works; the owner asks for them on what they changed by hand.

**Why it matters.** Today the only way an agent has to hear the verdict of a check is to say that it has finished. A refusal then runs every check, when one was of interest, and takes one of the refusals the settings allow. In Adaptive, under the harness Weaver rewrites, agents ran its `harness check` about 350 times in 8 of 36 sessions, nearly always one check at a time, on the slow checks of the backend and on the build of the documentation: the ones that failed most at the end of a task.

**Why it waits.** Most checks are the project's own programs, which run by hand, and Adaptive lists their commands in its instructions for agents. `warn` now tells an agent early what is fast to judge on one file, and `repair` takes what a program can fix. What is left to a refusal is less than it was under the harness.

**What would make it urgent.** Units of work that often need two or three refusals, as the journal of a project shows them, or failures that come mostly from the checks that do not run by hand, because they read what Weaver gives them: the files of the unit and the tree it started from.

**Where to start.** The command must know whose unit of work it judges. `weaver flag` settles the same question: the hook answers the call in place of the command, since it knows the session. A check lasts minutes where a hook before a call is given ten seconds, so either that time is raised for this call, or the hook only hands the session to the command, which then runs by itself. Outside a session, the command would judge the working tree against `HEAD`. The source harness does it in `task/gates/self-check.ts`.

## Places shared between sessions

**What.** `parallel`, in `settings.json`, becomes the number of checks that run at once in the whole repository, where it is today the number each session runs at once. A check takes a place before it starts, and waits when none is free.

**Why it matters.** Each session runs its checks without knowing of the others. Two agents that end a task at the same moment put twice the load on the machine, and a check that takes most of it may then run out of its time. It ends as a timeout, which holds the task and takes one of the refusals the settings allow, for a reason that is not the agent's.

**Why it waits.** It was measured on 2026-10-12, over the twelve days the harness Weaver rewrites ran in Adaptive, from its journal and from the transcripts of its Claude Code sessions. Of the 312 runs of its checks that lasted five seconds or more, 140 ends of task and 172 checks an agent asked for, 10 ran while another session was checking. Two sessions checked at once at six moments, for five minutes in all out of eighteen hours of checking, and never three. That harness shared two places between its sessions, and none of the 58 runs it kept shows a check that waited for one in vain. The runs where a check took over three times its usual time were looked at too: in 13 of 17, no other session was at work. These numbers do not see the checks a Codex session asked for, nor the commands an agent runs by hand, which a place held by Weaver would not cover either.

**What would make it urgent.** Checks that time out at the end of a task while another session is checking, or an owner who runs three agents or more in one repository.

**Where to start.** The checks of an end of task are started in `checks/running/project-checks.ts`, which counts the ones that run. The count would be kept in the state folder of the repository, which its sessions share, as files that each name the process holding a place: a place whose holder died is free again. Two things are to be decided first. The wait is taken from `totalTimeoutSeconds`, and one run of a slow check can last most of it, so a session that waits for another may run out of time before it has started anything: the source harness ended such a check as a timeout, which holds the task. And `parallel` counts checks, not what a check starts: a check that runs three programs at once takes one place. The source harness does it in `gates/runner/slots.ts`, for the checks it marks as heavy only.

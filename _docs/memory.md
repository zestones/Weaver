# Memory: flags and cards

What Weaver keeps of what agents discover. This is what the owner and I agreed on 2026-10-11, after two independent reviews of the design, one by Codex and one by Claude Code. None of it is built yet. What is still open is listed apart, and so is what waits for later.

## What it is for

Two needs, in the owner's words:

1. **Keep what an agent discovers** during its work and that the owner may have missed, so that the owner decides on it later: fix it, open an issue, or leave it.
2. **Use that memory and the git history** so that an agent does not undo a fix or a decision when it writes code.

This document is about the first need and the registry it rests on. The second, the recall, is deferred: what is known of it is at the end.

The registry of the source harness is not taken as it is. It mixed three roles: a pile of points for the owner, the recall of a file's past, and a knowledge base. It made an item of every bullet of two mandatory sections of the final message, tied an item to a file by the paths its text named, and guessed which commit carried a fix. Between 2026-09-24 and 2026-10-11 it created 1,080 items and closed 233, of which 231 on two days, when an agent proposed the closings and the owner accepted them in a batch.

## One registry

The ledger of the reviews goes away. Everything an agent, a reviewer or the owner leaves goes through flags and cards: there is one system.

| What                                                   | Does it enter | How                                                                                        |
| ------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------ |
| A discovery an agent leaves aside                      | Yes           | A flag, which the writer turns into a card.                                                |
| A finding of a review that its author did not fix      | Yes           | A card, straight from the review, with its rule and its quote. The writer is not involved. |
| What a reviewer suspects                               | Yes           | The same.                                                                                  |
| What the owner flags                                   | Yes           | A flag, from a terminal.                                                                   |
| A decision of the owner                                | Yes           | The closing of a card, with its reason.                                                    |
| A correction made during the task                      | Not now       | It serves the recall only, and comes with it. The review keeps the finding and its answer. |
| A constraint that explains why code must stay as it is | No            | It is the work of a comment in the code, which stays with the line.                        |
| The points to validate of a final message              | No            | The registry keeps what an agent discovers, not what it writes about its own change.       |
| What a check reports without blocking                  | Not now       | It would come back at every run until it is fixed.                                         |

A card says where it comes from: a flag, a finding, a suspicion or the owner. Each origin keeps its own content: a finding is not rewritten into the fields of a flag.

## Three words

| Word     | What it is                                            | Who writes it                         |
| -------- | ----------------------------------------------------- | ------------------------------------- |
| `flag`   | The raw report of a discovery.                        | The agent that found it, or the owner |
| `writer` | The agent Weaver starts to turn flags into cards.     |                                       |
| `card`   | The complete document the owner reads and decides on. | The writer, or a review               |

## The flag

A flag is the act of the one who finds, at the moment it finds. The agent runs `weaver flag` with the place and five fields, in a format Weaver imposes.

| Field      | What it says                                                                     |
| ---------- | -------------------------------------------------------------------------------- |
| the place  | One file or several, each with its line when there is one. A flag may have none. |
| `Seen`     | What it saw: the fact, not what it concludes from it.                            |
| `Expected` | What it expected instead.                                                        |
| `Found`    | What it was doing, and what alerted it.                                          |
| `Checked`  | What it verified, and what it did not.                                           |
| `Did`      | What it did about it: left as it is, worked around, or fixed in the task.        |

```
weaver flag platform/client/src/auth/token.ts:42 <<'EOF'
Seen: no call of refresh() exists under src/.
Expected: the token is refreshed before a request goes out, so something should call refresh().
Found: I was looking for the callers of getToken for my task, and read the whole file.
Checked: grep over src/ for a call of refresh(). I did not run the application: whether a token really stays expired is unknown.
Did: left as it is.
EOF
```

The keywords are English, like the other words Weaver reads. The content is in the language the agent writes in. A field may say that it is unknown.

**What decides the fields.** A flag asks for what only the one who found it knows. It does not ask for a title, labels, duplicates, a severity, the git history or a proposed fix: the writer or Weaver find those, and every field more is a reason not to flag. A flag that was never made cannot be detected, so a short one with unknowns is worth more than a discovery that was dropped.

**Who records it.** The hook that sees the call, not the command. The hook is given the session and the subagent with every call, so the author is never declared by the agent. The command the agent runs knows neither for sure, and under the default sandbox of Codex it cannot write under `.git/`. It only reads the record back and answers in one line, with the number of the flag.

**What Weaver does with it.**

- It refuses a flag it cannot use, and says what is missing: a field left out, a `Did` that is not one of the expected values. It does not judge a field by its length, which would only invite filling.
- It records the flag as written, with where it comes from and the lines of the code as they were at that moment. This record is never rewritten.
- It answers the agent, which goes on with its task and hears no more of it.

## The writer

A fresh agent that Weaver starts the way it starts a reviewer: in a process of its own, which the end of the turn does not stop. It has a limit of time and no limit of cost.

**When it starts.** At the end of the turn, once for all the flags of that turn. The files no longer change under it, one start serves several flags, and it sees them together, with their duplicates. The flag itself was recorded when it was made, so nothing is lost meanwhile. A turn that is cut leaves its flags raw until the next one ends.

**What it does.** It gathers the context, looks up what it needs, looks at the place to see whether what the flag says is true, and writes the card. It only reads: it runs no test and changes nothing. It does not investigate and does not look for proof, which is the work of whoever opens an issue afterwards.

**What it receives.**

- The flag, as a claim to look at, not as a fact, with the lines kept with it.
- The request of the owner that the agent was working on.
- Whether the flagged lines were there before the unit of work or come from it, which Weaver computes.
- The commits that wrote those lines, and the last commits of the file.
- The cards already known on these files, open or closed with their decision.
- The labels of the project, with what each means.
- The skill `wv-card.md`: how this project wants its cards written.

**What it does not receive.** The conversation of the agent that found the thing. It is long, and a second look is worth something only when it is independent.

**When it fails.** The flag stays, raw, marked as waiting to be written. A raw flag is listed and closed like a card.

## The card

A card follows a strict schema, in two parts.

**The header.** Weaver fixes its fields: a number, a short title, the labels, the files, where it comes from, the author (which runtime, as an author or as a reviewer), the session and the unit of work, the request of the owner, the date, the commit, and what the writer saw when it looked.

**The body.** Markdown, with callouts and mermaid diagrams where they help. The owner agreed on four sections:

| Section       | What it holds                                 | Fed by                       |
| ------------- | --------------------------------------------- | ---------------------------- |
| Observation   | What was seen, and where.                     | `Seen`, `Expected`           |
| Context       | What the agent was doing, and why it matters. | `Did`, the owner's request   |
| Trace         | How the agent came across it.                 | `Found`                      |
| Uncertainties | What was not verified.                        | `Checked`, the writer's look |

**What the project declares.** Its labels, as families and values, with the same words as its labels on GitHub (`type`, `area`, `status` for Adaptive). The sections of the body, in the header of the skill, as the finish skill lists the headings of a final message.

**What a card is not.** It gives enough context to be understood alone, months later. It is neither an investigation nor a certainty. Reproducing the problem, finding its cause and writing acceptance criteria come afterwards, if the owner decides to open an issue.

**What can happen to it.**

- The owner closes it, as `fixed`, `wontfix` or `issue`, with a reason. Weaver checks who closes: today nothing keeps an agent from running `weaver close`.
- It can be corrected, and opened again.
- When the thing is found again, the card gains an occurrence instead of a duplicate. A closed card that is found again is marked as seen since its closing; it is not reopened by itself.
- When two cards may be about the same thing and it is not sure, they stay two cards tied together, and a tie can be undone: a wrong merge hides a discovery.
- It has room for a closing that an agent proposes and that the owner accepts. That path is built after the first version.

A card keeps its flag word for word: what the agent said and what the writer made of it can always be compared.

## Where it is kept

In a SQLite database under `.git/weaver/`. The Node.js version Weaver requires ships SQLite, full-text search included, so it adds no dependency. Several processes write to it at once without losing anything, cards are found by file, label or state, and the whole registry is one file to copy.

It holds the flags and the cards only: the sessions and the journal stay as they are. The file cannot be read with `cat`, so a command prints a card as Markdown.

The registry lives on the owner's machine. Whether it must survive a change of machine or of clone is for later.

## Names

| Where                                               | Name                                        |
| --------------------------------------------------- | ------------------------------------------- |
| The command of the agent                            | `weaver flag`                               |
| The command that lists the cards                    | `weaver cards`, in place of `weaver status` |
| The command that decides on one                     | `weaver close`                              |
| The skill that says how a card is written           | `.weaver/skills/wv-card.md`                 |
| The labels of the project                           | `.weaver/project/labels.json`               |
| Who writes: the runtime, its model, effort and time | `.weaver/llm/writer.json`                   |

The command that opens an issue is declared with the reviewers today. It moves out of their file: a project without a reviewer must be able to open an issue from a card.

## Still open

To settle before the part concerned is built.

- **How an agent learns that the command exists.** Telling it once a session is too weak: the message is lost when the context is compacted, and it does not reach subagents. Today Weaver can only speak to an agent by refusing something. The second review proposes three lines in the instructions file of the project, and a reminder at the end of a task when a point found along the way has no flag.
- **`Did: fixed in the task` against the finish skill.** The template of the skill tells the agent never to do in the task what it found along the way. One of the two has to change.
- **What the writer saw**, as one of three: what it read agrees with the flag, contradicts it, or does not let it tell.
- **Cards whose line has changed since.** Weaver would say so, as a hint to look again, never as a closing.
- **A project that declares no writer** keeps its flags raw, and spends nothing.
- **`wontfix`** covers both "this is wanted" and "not now". The first should stop an agent later, the second should not.
- **The language of a card**, when agents write in two languages.

## What the reviews found, for the build

Not decisions: facts to keep in mind when the code is written.

- "It only reads" is not the same on both runtimes. A Claude Code task that reads has the tools Read, Grep and Glob. A Codex task that reads runs any command in a sandbox that forbids writing: in a read-only run on 2026-10-11, it ran 45.
- The hooks of the writer must stay silent, as those of a reviewer do, so that a writer can never flag.
- The cards of a file are given to its next reviewer, which is asked to check that none came back. What it reports again must become an occurrence, not a new card that the next review reports again.
- Worktrees share one registry: it belongs under the common git directory, where the journal already is, and a card must hold what it needs from a worktree that may be removed.
- A change of schema must never drop what the owner decided. The state of a session is dropped today when its version changes: that convention does not fit here.
- Writing each flag and each closing to the journal as well makes the database something that can be rebuilt.
- Weaver does not keep the request of the owner once its unit of work is closed. If the recall is to say why lines were changed, the journal has to start recording it.

## For later

**How big the pile may grow, and how long sorting it may take.** Settled when the registry is in use.

**An agent that proposes closings**, which the owner accepts in a batch. It is what emptied the pile of the source harness. After the first version.

**The recall against regressions.** Deferred by the owner on 2026-10-11, and the corrections made during a task come with it. The first idea started from git, at the line: when an agent changes lines that a commit of correction wrote, Weaver tells the agent, the reviewer and the owner. The first review showed where that breaks: a squash, a formatting commit, moved code, generated files, a fix that removes code, a regression that lands in another file. Adaptive has such a history: its commit `2331926a4` moves 852 files. What that review proposes instead is that the memory selects the decisions and the corrections tied to the files, and that git only adds hints. Nothing of this is decided.

## Plan

1. **Prove the attribution.** The hook records a flag. Real trials: two sessions at once in one folder, subagents, a command chained or run in the background, Claude Code and Codex, the payloads kept as fixtures. And who is allowed to close a card. The rest depends on it.
2. **The flag and a small registry.** `weaver flag`, what it refuses, the lines it keeps; listing and closing. Cards are raw at this point.
3. **A real trial, on raw cards**, on the clone of Adaptive. Two questions: do agents flag, and is a raw flag enough for the owner to decide?
4. **The writer.** `writer.json`, the skill `wv-card.md`, the start at the end of a turn, the card checked against its schema. It is judged on the flags of the trial.
5. **The complete card.** The labels, the ties and the occurrences, correcting and reopening. The ledger of the reviews moves into the registry.
6. **Afterwards.** The recall against regressions, defined with the owner first. Then the rest of the earlier plan: guards decided by a program and the comparison with the base, both in [to do later](todo-later.md), the distribution of Weaver, and the workbench, last.

Until Weaver is distributed, the agent has to be given the path of the command without writing it in a file that git follows.

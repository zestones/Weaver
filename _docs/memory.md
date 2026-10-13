# Memory: flags and cards

What Weaver keeps of what agents discover. This is what the owner and I agreed on 2026-10-11, after two independent reviews of the design, one by Codex and one by Claude Code. The first five steps of the plan were built the same day; what real sessions showed is told below. What is still open is listed apart, and so is what waits for later.

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

**Who records it.** The hook that sees the call, which also answers in place of the command. The hook is given the session and the subagent with every call, so the author is never declared by the agent. It records the flag and refuses the call, with the acknowledgement and the number of the flag as the reason of the refusal: the agent reads it and goes on. The command itself never runs for an agent, so nothing has to be on its `PATH`, and the default sandbox of Codex, which cannot write under `.git/`, is no obstacle. The owner flags with the same command from a terminal, where no hook is involved.

**What was proved on real sessions**, on 2026-10-11, with Claude Code and Codex running at the same time in one folder:

- The call that the hook sees carries the session, the id of the call and the whole command, heredoc included, in both runtimes; a chained command (`cd src && … weaver flag …`) arrives whole too.
- A call made by a subagent of Claude Code carries the session of its parent and the id of the subagent.
- An environment variable proves nothing: the session id of an outer Claude Code session leaks into the hooks of a Codex session started under it.
- Both runtimes show the reason of a refusal to the agent, which understands that the command did not run and that this is expected.
- Both runtimes give to the model the context a hook adds to a request: this is how an agent is told that the command exists.

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

**What a card is not.** It gives enough context to be understood alone, months later. It is neither an investigation nor a certainty. Reproducing the problem and finding its cause come afterwards, when the owner asks an agent to verify the card: what the agent finds is written on the card, and goes with it if it becomes an issue.

**What can happen to it.**

- The owner closes it, as `fixed`, `wontfix`, `issue` or `invalid`, with a reason. `invalid` is for a card whose flag proved not to be true. Weaver checks who closes: the command refuses to run under an agent.
- It can be written on, as long as it exists: by an agent the owner asked to verify or to fix it, and by the owner. A note may conclude: `confirmed`, `refuted`, `unsure` or `fixed`.
- It can be corrected, and opened again.
- When the thing is found again, the card gains an occurrence instead of a duplicate. A closed card that is found again is marked as seen since its closing; it is not reopened by itself.
- When two cards may be about the same thing and it is not sure, they stay two cards tied together, and a tie can be undone: a wrong merge hides a discovery.
- It has room for a closing that an agent proposes and that the owner accepts. Nothing writes it: see the life of a card, below.

A card keeps its flag word for word: what the agent said and what the writer made of it can always be compared.

**Who reads it, and where.** The owner said on 2026-10-11 how the two readers differ. `weaver cards` is what an agent runs in a chat, to read the registry for the owner or for its own work. A person will browse the cards, decide on them and ask for an investigation in an interface of their own. It was to be a web workbench, which the owner cancelled on 2026-10-13 for a screen in the terminal: see [to do later](todo-later.md). Until it exists, the commands are where the owner decides.

## The life of a card

Settled with the owner on 2026-10-13, with the cards of the first project at hand: twenty-one after a day, none closed.

**The registry is a backlog, not a pile to empty.** A card is open or closed, with no state in between, and may stay open without limit, read or not. Weaver does not keep what the owner has read. Now and then the owner takes one card out:

- it is fixed directly, by the agent at work on something close or by a second one started beside it;
- or an agent is asked to verify it. When it proves true, it is fixed now, or becomes an issue when it cannot be. When it does not, it is closed as `invalid`.

An issue is therefore a card that proved true and cannot be handled now. Its life goes on where the issues are, and the card is finished.

**What is written on a card.** `weaver note <number>`, with what the note concludes of the card if it concludes, then its text, on the line or in a heredoc. For an agent, the hook answers in place of the command, as for a flag: it knows the session, the unit of work and the request. For the owner, the command writes it. A note that the hook sees twice is written once.

**How an agent knows.** The card as an agent reads it, `weaver cards <number>` under a runtime, ends with the command to write on it, its number filled in. The owner does not read that part, and it is not in the issue a card becomes. Nothing is added to the briefing of every request: what an agent is told decides whether it uses a command, and this one is told at the moment it is needed.

**How a card stands.** The last conclusion written on an open card is shown with its state, in the list and on its page: `open (confirmed)`. A flag that says `Did: fixed in the task` is the first conclusion of its card, so a card born fixed reads `open (fixed)` and waits for the owner all the same: two of the first three said that something was left. A card that is opened again is to be looked into again, and what was concluded before no longer stands. Nothing is decided by a conclusion: the owner closes.

**Left out, each for a reason.**

- A mark on a card the owner has read. The owner reads without judging, and does not open most cards: nearly all would keep the mark.
- A mark on a card an agent is working on. Nothing would remove it when a session dies. To take up again if the owner hands one card to two agents.
- Closings proposed in a batch by an agent, for which the record has room. They were meant to empty the pile, which is no longer a goal.

## Where it is kept

In a SQLite database under `.git/weaver/`. The Node.js version Weaver requires ships SQLite, full-text search included, so it adds no dependency. Several processes write to it at once without losing anything, cards are found by file, label or state, and the whole registry is one file to copy.

It holds the flags and the cards only: the sessions and the journal stay as they are. The file cannot be read with `cat`, so a command prints a card as Markdown.

The registry lives on the owner's machine. Whether it must survive a change of machine or of clone is for later.

## Names

| Where                                               | Name                                        |
| --------------------------------------------------- | ------------------------------------------- |
| The command of the agent                            | `weaver flag`                               |
| The command that lists the cards                    | `weaver cards`, in place of `weaver status` |
| The command that writes on one                      | `weaver note`                               |
| The command that decides on one                     | `weaver close`                              |
| The skill that says how a card is written           | `.weaver/skills/wv-card.md`                 |
| The labels of the project                           | `.weaver/project/labels.json`               |
| Who writes: the runtime, its model, effort and time | `.weaver/llm/writer.json`                   |

The command that opens an issue is declared with the reviewers today. It moves out of their file: a project without a reviewer must be able to open an issue from a card.

## Settled while building

The owner asked for the plan to be built without stopping. These were open, and were settled as follows; each can be changed.

- **How an agent learns that the command exists.** Weaver adds a few lines to every request of the owner, through the hook: they survive a compacted context, which a message given once a session does not. The template of the finish skill says the same.
- **`Did: fixed in the task` against the finish skill.** The template of the skill now says to flag what is found along the way and not to do it in the task, unless the task cannot go on without it: it is then flagged as fixed.
- **What the writer saw** is one of three: what it read agrees with the flag, contradicts it, or does not let it tell, with a note that says what it read.
- **Cards whose line has changed since.** `weaver cards` says so, as a hint to look again, never as a closing.
- **A project that declares no writer** keeps its flags raw, and spends nothing.
- **The command that files an issue** is declared in `.weaver/project/issues.json`.

## What the real trials showed

On 2026-10-11, with real sessions of Claude Code in the clone of Adaptive and of Codex in a small project.

- **What an agent is told decides whether it flags.** With a first wording, both runtimes saw a real defect of Adaptive, wrote about it in their final message and flagged nothing. With a second one, which said in advance that the call would be refused, Claude Code believed the command did not work and did not run it. With the third, which says to flag even what the final message also tells and that the hook's message is the answer, Claude Code flagged the defect by itself twice, and Codex flagged one too.
- **From the flag to the card.** The writer, Claude Code on Sonnet with the skill of Adaptive, wrote a card in French with its four sections in 14 seconds, for 0.11 dollar. The second flag of the same defect was merged into the first card as an occurrence.
- **Codex loads the hooks of a project only when the project is trusted** in the owner's `~/.codex/config.toml`. The clone of Adaptive is not: Codex ran there unsupervised, was told nothing, and its `weaver flag` ran for real. Trusting a project is the owner's to do. Codex also runs a hook only once the owner has approved it as it is written, and asks again when it changes. `weaver doctor` asks Codex itself whether it runs the hooks of the project, and says so when it does not.
- **The sandbox of Codex puts the runtime at the first process.** The check of who runs a command now looks there too: before, a `weaver flag` run by an unsupervised Codex took itself for the owner's.
- **A label came back with its family in front** (`type:bug` as the value) and was dropped. The writer is now told what a family and a value are, and both forms are taken.

## Still open

- **`wontfix`** covers both "this is wanted" and "not now". The first should stop an agent later, the second should not. It matters for the recall, and waits for it.
- **The language of a card**, when agents write in two languages. Today the skill of the project says how its cards are written, language included.
- **A reminder at the end of a task**, when the final message names something found along the way that has no flag. Not built: the agent is told about the command with every request instead.

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

**An agent that proposes closings**, which the owner accepts in a batch. It is what emptied the pile of the source harness. Left out on 2026-10-13: the registry is a backlog, and emptying it is no longer a goal.

**The recall against regressions.** Deferred by the owner on 2026-10-11, and the corrections made during a task come with it. What is known of it is in [to do later](todo-later.md).

## Plan

The first six steps are built. The owner asked for the first five in one go, so the trial of step 3 came after the writer instead of before it.

1. **Prove the attribution.** Done: the hook records a flag, on real payloads of both runtimes kept as fixtures, with two sessions at once, a subagent and a chained command. The owner's commands are refused to an agent, by a guard and by the commands themselves.
2. **The flag and a small registry.** Done: `weaver flag`, what it refuses, the lines it keeps; listing and closing.
3. **A real trial.** Done for the first question: agents flag, once they are told well. The second, whether a raw flag is enough for the owner to decide, is the owner's to answer.
4. **The writer.** Done: `writer.json`, the skill `wv-card.md`, the start at the end of a turn, the card checked against its schema.
5. **The complete card.** Done: the labels, the ties and the occurrences, correcting and reopening. The ledger of the reviews is gone, and what a review leaves is a card.
6. **The life of a card.** Done: `weaver note`, the conclusion an open card stands with, the `invalid` closing, the notes in the issue a card becomes.
7. **Afterwards.** An interface in the terminal where the cards are browsed: the web workbench first planned is cancelled. It waits in [to do later](todo-later.md), with the recall against regressions, guards decided by a program and the comparison with the base, and so does the distribution of Weaver. Putting Weaver in place of the source harness on the real work is the owner's to decide.

An agent needs no path to the command: the hook answers in its place.

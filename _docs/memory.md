# Memory: flags and cards

What Weaver keeps of what agents discover, and how it will use it. This is what the owner and I agreed on 2026-10-11. None of it is built yet. What the owner has not confirmed is listed apart, and so is what is not defined.

## What it is for

Two needs, in the owner's words:

1. **Keep what an agent discovers** during its work and that the owner may have missed, so that the owner decides on it later: fix it, open an issue, or leave it.
2. **Use that memory and the git history** so that an agent does not undo a fix or a decision when it writes code.

The registry of the source harness is not taken as it is. It mixed three roles: a pile of points for the owner, the recall of a file's past, and a knowledge base. It made an item of every bullet of two mandatory sections of the final message, tied an item to a file by the paths its text named, and guessed which commit carried a fix. Between 2026-09-24 and 2026-10-11 it created 1,054 items, of which 233 were closed.

## Three words

| Word     | What it is                                            | Who writes it                          |
|----------|-------------------------------------------------------|----------------------------------------|
| `flag`   | The raw report of a discovery.                        | The agent that found it, or a reviewer |
| `writer` | The agent Weaver starts to turn a flag into a card.   |                                        |
| `card`   | The complete document the owner reads and decides on. | The writer                             |

## The flag

A flag is the act of the one who finds, at the moment it finds. The agent runs `weaver flag` with the place and five fields, in a format Weaver imposes.

| Field      | What it says                                           |
|------------|--------------------------------------------------------|
| the place  | The file, and the line when there is one.              |
| `Seen`     | What it saw.                                           |
| `Expected` | What it expected instead.                              |
| `Found`    | What it was doing, and what alerted it.                |
| `Checked`  | What it verified, and what it did not.                 |
| `Did`      | What it did about it: left as it is, or worked around. |

```
weaver flag platform/client/src/auth/token.ts:42 <<'EOF'
Seen: refresh() is called nowhere, so an expired token stays expired.
Expected: the token is refreshed before a request goes out.
Found: I was looking for the callers of getToken for my task, and read the whole file.
Checked: grep finds no call of refresh() under src/. I did not run the application.
Did: left as it is.
EOF
```

The keywords are English, like the other words Weaver reads. The content is in the language the agent writes in.

**What decides the fields.** A flag asks for what only the one who found it knows. It does not ask for a title, labels, duplicates, a severity, the git history or a proposed fix: the writer or Weaver find those, and every field more is a reason not to flag. A flag that was never made cannot be detected.

**What Weaver does with it.**

- It names the session from the call its hook has just seen: the author is never declared by the agent.
- It refuses a flag it cannot use, and says what is missing: a field left out, a field of a few words, a file that does not exist, a `Did` that is not one of the expected values.
- It records the flag as written, with where it comes from. This text is never rewritten.
- It starts the writer at once, in the background, and answers the agent in one line. The agent hears no more of it.

## The writer

A fresh agent that Weaver starts for each flag, the way it starts a reviewer: in a process of its own, which the end of the turn does not stop. It reads the repository. It runs no command and writes no file.

**What it receives.**

- The flag, as a claim to look at, not as a fact.
- The request of the owner that the agent was working on.
- Whether the flagged lines were there before the unit of work or come from it, which Weaver computes.
- The commits that wrote those lines, and the last commits of the file.
- The cards already known on these files, open or closed with their decision.
- The labels of the project, with what each means.
- The skill `wv-card.md`: how this project wants its cards written.

**What it does not receive.** The conversation of the agent that found the thing. It is long, and a second look is worth something only when it is independent.

**What it does.** It goes to the place, says whether it sees the same thing, and writes the card. It does not investigate.

## The card

A card follows a strict schema, in two parts.

**The header.** Weaver fixes its fields: a short title, the labels, the files, the author (which runtime, as an author or as a reviewer), the session and the unit of work, the request of the owner, the date, the commit, and whether the writer saw the same thing.

**The body.** Markdown, with callouts and mermaid diagrams where they help. The owner agreed on four sections:

| Section       | What it holds                                 | Fed by                       |
|---------------|-----------------------------------------------|------------------------------|
| Observation   | What was seen, and where.                     | `Seen`, `Expected`           |
| Context       | What the agent was doing, and why it matters. | `Did`, the owner's request   |
| Trace         | How the agent came across it.                 | `Found`                      |
| Uncertainties | What was not verified.                        | `Checked`, the writer's look |

**What the project declares.** Its labels, as families and values, with the same words as its labels on GitHub (`type`, `area`, `status` for Adaptive). The sections of the body, in the header of the skill, as the finish skill lists the headings of a final message.

**What a card is not.** It gives enough context to be understood alone, months later. It is neither an investigation nor a certainty. Reproducing the problem, finding its cause and writing acceptance criteria come afterwards, if the owner decides to open an issue.

A card keeps its flag word for word: what the agent said and what the writer made of it can always be compared.

## Names

| Where                                               | Name                                        |
|-----------------------------------------------------|---------------------------------------------|
| The command of the agent                            | `weaver flag`                               |
| The command that lists the cards                    | `weaver cards`, in place of `weaver status` |
| The command that decides on one                     | `weaver close`, unchanged                   |
| The skill that says how a card is written           | `.weaver/skills/wv-card.md`                 |
| The labels of the project                           | `.weaver/project/labels.json`               |
| Who writes: the runtime, its model, effort and time | `.weaver/llm/writer.json`                   |

## Proposed, and not confirmed by the owner

To settle before the code is written.

- The ledger of the reviews becomes the cards, and what a reviewer suspects goes through the writer. There is one system, not two.
- Only the owner closes a card, as `fixed`, `wontfix` or `issue`, with a reason.
- A card that is found again gains an occurrence instead of a duplicate. A closed card that is found again is marked as seen after its closing.
- Weaver says which cards point at a line that has changed since, to help the owner empty the pile.
- One writer runs at a time in a repository, so that the second sees the card of the first. A project that declares no writer keeps its flags raw, and spends nothing.
- A flag whose writer failed stays, marked as waiting to be written.
- The cards live in `.git/weaver/`, on the owner's machine, not in git.
- Weaver tells the agent once a session that the command exists, and the summary of the end of a turn counts the flags made during it.
- What a check reports without blocking does not become a card for now: it would come back at every run until it is fixed.
- Not taken from the source harness: the measure of how alike two items are, the import of transcripts, the typed accounts with assertions and proofs, the enrichment by a model.

## Not defined yet: the recall against regressions

The owner found this direction better than the recall of the source harness. Its details are open.

It starts from git, at the line. When an agent changes lines that a commit of correction wrote, Weaver tells the agent, tells the reviewer, and says so in the report for the owner, with the cards of the file. The project says what a commit of correction looks like. Adaptive has 423 `fix` commits out of 2,734, and since 2026-09-01, 122 of 150 touch a test file.

## Plan

1. **The cards, without an agent.** Where they are kept, the schema of the header, `labels.json`, `weaver cards` and `weaver close`. The ledger of the reviews moves into them.
2. **The flag.** `weaver flag`, what it refuses, where a flag comes from. Cards are raw at this point, and usable.
3. **The writer.** `writer.json`, the skill `wv-card.md`, the start in the background, the card checked against its schema, the tie to the cards that exist.
4. **A real trial** on the clone of Adaptive, with its GitHub labels and real sessions of Claude Code and Codex.
5. **The recall against regressions.** Defined with the owner first, then built on the cards and on git.
6. **The rest of the earlier plan.** Guards decided by a program and the comparison with the base, both in [to do later](todo-later.md), then the distribution of Weaver, then the workbench, last.

Until Weaver is distributed, `weaver install` has to give the agent the exact path of the command.

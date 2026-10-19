# Development toolchain

Weaver uses a pnpm workspace, strict TypeScript and ESM. The root provides shared configuration and checks; applications and domain packages are added when their behavior is implemented.

Use the Node.js version in `.node-version` and the pnpm version recorded in `package.json`. Install dependencies with `pnpm install --frozen-lockfile` on a fresh checkout.

## Commands

| Command             | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `pnpm build`        | Run package build scripts in dependency order, one package at a time.             |
| `pnpm typecheck`    | Run package type checks sequentially.                                             |
| `pnpm lint`         | Check JavaScript and TypeScript with zero warnings allowed.                       |
| `pnpm knip`         | Detect unused files, exports and dependencies across the workspace.               |
| `pnpm test`         | Run package test scripts sequentially.                                            |
| `pnpm format`       | Format repository files.                                                          |
| `pnpm format:check` | Check formatting without writing.                                                 |
| `pnpm check`        | Run formatting, builds, types, lint, unused-code analysis and tests sequentially. |

The mod that shows the end of a task in the chat of Claude Code, `apps/cli/mods/weaver-status/`, runs inside Claude Code against the types its build writes: `claude plugin validate apps/cli/mods/weaver-status` and `claude plugin test apps/cli/mods/weaver-status` check it, on a workstation where Claude Code is installed. Its `types/index.d.ts` repeats the shape of `progress.json`, `packages/engine/src/loop/progress/progress-record.ts`: a change of one is a change of the other.

`pnpm check` is the one command that judges the repository, on a workstation and in the [CI](#continuous-integration-and-releases). Recursive package commands use one workspace slot. Each package must configure its own test runner with one worker and no parallel test files. These limits reduce concurrent work; they are not a hard memory quota.

Knip discovers workspace packages from `pnpm-workspace.yaml` and tooling entry points through its plugins. `knip.json` declares the root project files without treating every file as an entry point. Add actual executable entry points when applications are implemented; do not hide unused code or dependencies with blanket exclusions.

## Continuous integration and releases

Two workflows live in `.github/workflows/`.

| Workflow      | Trigger                                 | What it does                                                                                    |
| ------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ci.yml`      | A push to `main`, every pull request    | Runs `pnpm check`.                                                                              |
| `release.yml` | A version tag, or a run started by hand | Runs `pnpm check`, builds the archive, writes the notes and publishes them as a GitHub Release. |

### Cutting a release

```sh
git tag v0.1.0
git push origin v0.1.0
```

The tag decides the version. Nothing in the sources is edited for a release: the copy that ships is stamped with the tag, and a checkout keeps saying `weaver 0.0.0-dev`. Choose the number from what the notes will say: a breaking change, a feature, or fixes only.

A run of `release.yml` started by hand, with a version, is a rehearsal. It builds the archive and the notes, keeps them with the run for a week, and publishes nothing. To publish a version again, delete its release first.

The notes are written from the commits since the release before. Commits follow Conventional Commits, so a subject says where it goes: a `feat` under Features, a `fix` under Fixes, and whatever carries a `!` under Breaking changes.

### What a release holds

| File                      | What it is                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `weaver-<version>.tar.gz` | The command, the engine and what they depend on, built. It needs only Node.js 24.13 or later. |
| `SHA256SUMS`              | The digest of the archive.                                                                    |
| `install.sh`              | The script that installs the archive for the current user.                                    |

The scripts of `tools/release/` do the work, and run on a workstation as they do in the workflow:

| Script                                | What it does                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `package.sh <version> [<out folder>]` | Builds the archive and its digest, into `dist/` by default, and tries the copy before it packs it.  |
| `notes.sh <version>`                  | Prints the notes of the release.                                                                    |
| `install.sh <archive>`                | Installs an archive. `WEAVER_HOME` and `WEAVER_BIN` move where it goes, to try one without a trace. |

### Installing a release

The first time, with the three files a release carries:

```sh
gh release download --repo zestones/Weaver --dir weaver-release && cd weaver-release
sha256sum --check --ignore-missing SHA256SUMS
bash install.sh weaver-v*.tar.gz
```

The release goes to `~/.local/share/weaver/<version>/`, and `~/.local/bin/weaver` points at it. Versions stay side by side: a supervised project runs the one that wired it until `weaver update` is run in it, and `weaver doctor` says which release wired a project that is behind.

After that, `weaver update` is the one command that keeps things up to date. It does three things in order:

1. **Weaver.** It reads the latest release on GitHub. When that one is later, it fetches its archive, its checksums and its `install.sh`, runs that script, then starts the release it installed with `update --offline`: that release finishes, since the one that fetched it may not know its format.
2. **The configuration.** It applies the migrations the project lacks, and names each with what it changed.
3. **The hooks.** It wires again the runtimes that were wired, and plugs in no other.

`--dry-run` says what it would do and writes nothing. When a later release is published, it shows what that release says changed, then unpacks it in a temporary folder, once its archive matches its sums, and asks it for its own dry run on the project: an earlier Weaver does not hold the migrations of a later one. Nothing is installed. `--offline` looks for no release; a checkout looks for none either, since git updates it. The command is the owner's. `weaver install` only puts Weaver on a project: it leaves a project in another format to `weaver update`.

### Migrations

`version`, in `settings.json`, is the version of the format of the files of `.weaver/`, not the version of Weaver. A change that an earlier Weaver could not read, such as a field renamed or a field that becomes required, is a new version, and comes with its migration:

- a file in `packages/engine/src/declaration/migrations/`, named by the version it brings the files to and by what it changes, such as `0002-check-commands.ts`. Its class extends `Migration` and lists operations;
- the operations are in `migrating/operations/`: `RenamedField`, `AddedField`. A change none of them expresses is a new operation, with its test;
- the migration is added to `DeclarationMigrations.ALL`, and the `const` of `version` in the settings schema goes up by one. A test holds the three together: the list, the files and the schema.

A migration is never edited once a release carries it. Files of an earlier version are not read as they are: the hooks and `weaver doctor` tell the owner to run `weaver update`.

The registry of cards, under `.git/weaver/`, has a schema of its own: one entry for each version in `packages/memory/src/registry/registry-schema.ts`, never edited once a release carries it, and each keeps every card. A later Weaver brings a registry up to date the first time it opens it. An earlier one then refuses to read it, and says so: update a project when no agent works in it.

## TypeScript and packages

`tsconfig.base.json` contains shared strictness and Node.js module resolution defaults. There is no root compilation project or root test-runner configuration.

Each Node.js package supplies its own `tsconfig.json`, which extends `tsconfig.base.json`, declares its environment types and covers its source, its tests and its test-runner configuration without emitting: the type-check script and ESLint both read it. A `tsconfig.build.json` beside it extends it and emits `dist` from `src` alone, with declarations. Its manifest declares a build script, a type-check script and explicit public `exports` with `types` and `import` targets pointing to emitted files. Internal dependencies use the `workspace:` protocol and are declared by the consuming package. Browser applications override the Node.js defaults with their bundler and browser settings.

Do not add TypeScript path aliases that bypass workspace manifests. Package exports restrict imports by package name; ESLint additionally rejects common imports into workspace `src` and `dist` paths. A complete dependency allowlist and restrictions on relative imports across package boundaries will be added with the first actual packages.

Tests and their Vitest configuration live inside their owning application or package, and are type-checked with it. Browser configuration and browser tests will be introduced with the web application rather than inheriting Node.js assumptions.

`packages/engine` is the first package. A package's test runner must fail when its suite is unexpectedly empty.

## Conventions

Use explicit types at public boundaries, type-only imports and checked asynchronous operations. TypeScript rejects unchecked indexed access, ambiguous optional values, unused declarations and missing return paths. ESLint uses type information from each file's nearest TypeScript project.

Formatting uses two spaces, single quotes, no semicolons, LF endings and preserved Markdown paragraphs. Keep generated files and temporary fixtures out of version control. Documentation and code are written in English.

### What agents are told

How to work under Weaver is written once, in the guide, `packages/engine/src/guidance/guide/`: what Weaver does around an agent, each command with when and how to use it, and what is the owner's. Two other places speak to an agent, and neither repeats it:

- the briefing of each request, `guidance/briefing/`, gives one line for each moment a command is for, and points to the guide;
- a hook says what its moment needs: what happened and what to do now. It may give the exact form of the command to type then, such as the format of a flag or of a note, which is defined once beside its parser.

A command an agent should use gets its line in the briefing and its part of the guide, and a hook only when a moment calls for it. A test fails when the guide names a command `weaver` does not have.

### Classes

The source of a package is object-oriented. Behavior lives in classes: a module declares no function at its top level, a file holds one class and is named after it in kebab-case, and a class that only groups static functions is not a class. Use an interface for a contract several classes fulfil, and an abstract class where they share a skeleton and differ in one step; do not inherit only to share code. A callback written where it is passed, as in `files.map((file) => file.path)`, is not a function declaration.

A package's `lib/` folder is the exception. It holds pure transformations and plumbing that know nothing of the package's concepts, such as a parser or the git commands, and may declare functions. `lib/` imports nothing from the rest of the package.

Shapes written to disk or read from another program, such as a saved state or a line of a journal, are interfaces without methods. The classes that give them behavior are built from them.

The interface of `weaver ui`, under `apps/cli/src/ui/`, is the second exception. It is drawn with [Ink](https://github.com/vadimdemedes/ink), which is React in a terminal, and a component of React is a function: the `.tsx` files hold components, one that is exported in each, with the small ones only it uses beside it. Nothing else is a function there. What the screen shows and what each key does is `model/ui-model.ts`, a class; each box is a class under `forms/`; and what is done to a card goes through `cards/card-desk.ts`, which the commands go through too. A component draws what the model holds and hands it the keys: it decides nothing. Ink and React are loaded by `weaver ui` alone, as the parser of Markdown is loaded to draw a card.

The mod of Claude Code, under `apps/cli/mods/weaver-status/`, is the third exception. Claude Code takes `$`, its interface to the session, only in a function declared at the top of a module: what calls `$` is such functions in `hooks/register.tsx`, and what is shown is worked out by a class, `hooks/end-of-task-view.ts`.

### Folders

A folder holds sub-folders or files, never both. `src/index.ts`, the entry of a package, is the one file allowed beside folders. As soon as files form a family, such as a base class and its subclasses, they get a sub-folder of their own.

The folders of a package are layers, read from the top: a file imports from its own layer and from those below it, never from one above. In the engine these are `bin`, then `loop`, then `verdict`, then `checks`, `guards`, `review`, `flagging` and `noting` side by side, then `unit-of-work`, `declaration` and `agents` side by side, then `lib`. Start reading at `loop/dispatch/loop.ts`. The memory package, `packages/memory`, has `bin`, `writing`, `registry`, `notes`, `cards`, `flags` and `lib`, and imports nothing from the engine: start reading at `registry/card-registry.ts`.

### Comments

Write only the comments a reader could not do without: a reason the code cannot show and that someone would otherwise undo, such as a workaround, a deliberate omission or a rule of the domain. Do not document a class, a method or a field whose name already says it.

### What the command line prints

A command of `apps/cli` never writes a line by itself. It says what it has to say to a `Screen` (`output/screen.ts`): a heading, something done, a problem, a note, a hint, a table, an error. The screen draws it, and is the one place that holds the marks, the colours and the indentation: changing the look of every command is a change there.

The conventions are those of the [Command Line Interface Guidelines](https://clig.dev/) and of the design guide of GitHub's command line:

- The answer of a command goes to the standard output, and what went wrong to the error stream, through `Screen.error` and `Screen.misuse`. A command returns 0, 1 when it failed, and 2 when it was given words it cannot use.
- A sentence starts with a capital and says what happened; a count takes its plural from `Counted`, never `(s)`.
- A state is a mark at the start of the line, so that it reads without colour. Colour only repeats it, and `Paint` leaves it out for a pipe, for `NO_COLOR`, for a dumb terminal and for `--no-color`.
- A command declares its `help`: the part of the help it is listed in, its description, the words of its usage line, and examples. `weaver help` is built from these, so a command that is added is documented by being written.
- What is drawn only for a person, such as a card, goes through `Screen.page`: it takes what is written, which a program is given as it is, and what draws it for a terminal. A card is drawn by `cards/card-page.ts` from what the card holds, not from its Markdown: only what someone wrote as Markdown, the sections of the writer and the words of a review, goes through `markdown/terminal-markdown.ts`. Markdown is read by [marked](https://marked.js.org/) and code is coloured by the grammars of [highlight.js](https://highlightjs.org/): what Weaver holds is only how each thing they find is drawn, and the colour of each kind of thing a grammar names, taken from the palette of the terminal so that code follows the theme of its owner. A page has a margin on each side and a blank line above and under, which `Screen.page` adds. Both are loaded when a card is drawn and not before, so no other command pays for them. They are the only two packages the command line takes from outside this repository, and neither brings another with it.
- A test reads what a command prints through `weaver()` in `test/fixtures/project.ts`, which records both streams without colour: what a test asserts is what an agent reads.

### What holds these rules

| Rule                                                                              | Held by                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| No module-level function outside `lib/`, one class per file, no static-only class | ESLint, for `packages/*/src`                     |
| Layer order of each package                                                       | ESLint, `LAYERS` in `eslint.config.mjs`          |
| No folder with both files and sub-folders                                         | `packages/engine/test/structure/folders.test.ts` |
| Families in sub-folders, and comments                                             | Review                                           |

A new package adds its own layer list to `eslint.config.mjs` and its own copy of the folder test.

### Using another package

A package that uses another reads its emitted types and runs its emitted code, so `pnpm check` builds before it type-checks, lints and tests.

### Running the CLI on a project

`weaver install`, run at the root of a project, writes the hooks of the agent runtimes and a starter `.weaver/` folder: the settings, one file for each part of what the project asks, and the skill that says how a task ends. `weaver doctor` checks that the wiring is alive, and `weaver uninstall` removes the hooks. A runtime may hold hooks and not run them: Codex loads the hooks of a project once the owner trusts the project, and runs each one once the owner has approved it, so the doctor asks Codex and says when agents work there without Weaver. `weaver cards` lists what agents flagged and what reviews left for the owner, `weaver cards <number>` prints one card, and `weaver close` decides on it; the [memory design](memory.md) says how a flag becomes a card. To have the command on this machine, build the workspace, then link its entry into a folder of your `PATH`, for example `ln -s "$PWD/apps/cli/dist/bin/weaver.js" ~/.local/bin/weaver` from the root of this repository. The build makes the entry executable.

The commands that decide or change something are the owner's: they refuse to run when a `claude` or `codex` process is among their ancestors, so run them from a terminal of your own, not from inside an agent session.

This is temporary. Weaver is not distributed yet, so a project is wired to this checkout by absolute paths: the hooks and the `$schema` line stop working when the checkout moves or its `dist/` is removed, and they belong to one machine. The `TODO(distribution)` in `apps/cli/src/link/engine-link.ts` marks what to replace once Weaver is published.

# Development toolchain

Weaver uses a pnpm workspace, strict TypeScript and ESM. The root provides shared configuration and checks; applications and domain packages are added when their behavior is implemented.

Use the Node.js version in `.node-version` and the pnpm version recorded in `package.json`. Install dependencies with `pnpm install --frozen-lockfile` on a fresh checkout.

## Commands

| Command             | Purpose                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm build`        | Run package build scripts in dependency order, one package at a time. No application build exists yet. |
| `pnpm typecheck`    | Run package type checks sequentially.                                                                  |
| `pnpm lint`         | Check JavaScript and TypeScript with zero warnings allowed.                                            |
| `pnpm knip`         | Detect unused files, exports and dependencies across the workspace.                                    |
| `pnpm test`         | Run package test scripts sequentially.                                                                 |
| `pnpm format`       | Format repository files.                                                                               |
| `pnpm format:check` | Check formatting without writing.                                                                      |
| `pnpm check`        | Run formatting, builds, types, lint, unused-code analysis and tests sequentially.                      |

Checks run locally through `pnpm check`; no GitHub Actions workflow is configured. Recursive package commands use one workspace slot. Each package must configure its own test runner with one worker and no parallel test files. These limits reduce concurrent work; they are not a hard memory quota.

Knip discovers workspace packages from `pnpm-workspace.yaml` and tooling entry points through its plugins. `knip.json` declares the root project files without treating every file as an entry point. Add actual executable entry points when applications are implemented; do not hide unused code or dependencies with blanket exclusions.

## TypeScript and packages

`tsconfig.base.json` contains shared strictness and Node.js module resolution defaults. There is no root compilation project or root test-runner configuration.

Each Node.js package supplies its own `tsconfig.json`, which extends `tsconfig.base.json`, declares its environment types and covers its source, its tests and its test-runner configuration without emitting: the type-check script and ESLint both read it. A `tsconfig.build.json` beside it extends it and emits `dist` from `src` alone, with declarations. Its manifest declares a build script, a type-check script and explicit public `exports` with `types` and `import` targets pointing to emitted files. Internal dependencies use the `workspace:` protocol and are declared by the consuming package. Browser applications override the Node.js defaults with their bundler and browser settings.

Do not add TypeScript path aliases that bypass workspace manifests. Package exports restrict imports by package name; ESLint additionally rejects common imports into workspace `src` and `dist` paths. A complete dependency allowlist and restrictions on relative imports across package boundaries will be added with the first actual packages.

Tests and their Vitest configuration live inside their owning application or package, and are type-checked with it. Browser configuration and browser tests will be introduced with the web application rather than inheriting Node.js assumptions.

`packages/engine` is the first package. A package's test runner must fail when its suite is unexpectedly empty.

## Conventions

Use explicit types at public boundaries, type-only imports and checked asynchronous operations. TypeScript rejects unchecked indexed access, ambiguous optional values, unused declarations and missing return paths. ESLint uses type information from each file's nearest TypeScript project.

Formatting uses two spaces, single quotes, no semicolons, LF endings and preserved Markdown paragraphs. Keep generated files and temporary fixtures out of version control. Documentation and code are written in English.

### Classes

The source of a package is object-oriented. Behavior lives in classes: a module declares no function at its top level, a file holds one class and is named after it in kebab-case, and a class that only groups static functions is not a class. Use an interface for a contract several classes fulfil, and an abstract class where they share a skeleton and differ in one step; do not inherit only to share code. A callback written where it is passed, as in `files.map((file) => file.path)`, is not a function declaration.

A package's `lib/` folder is the exception. It holds pure transformations and plumbing that know nothing of the package's concepts, such as a parser or the git commands, and may declare functions. `lib/` imports nothing from the rest of the package.

Shapes written to disk or read from another program, such as a saved state or a line of a journal, are interfaces without methods. The classes that give them behavior are built from them.

### Folders

A folder holds sub-folders or files, never both. `src/index.ts`, the entry of a package, is the one file allowed beside folders. As soon as files form a family, such as a base class and its subclasses, they get a sub-folder of their own.

The folders of a package are layers, read from the top: a file imports from its own layer and from those below it, never from one above. In the engine these are `bin`, then `loop`, then `verdict`, then `checks`, `guards` and `review` side by side, then `unit-of-work`, `declaration` and `agents` side by side, then `lib`. Start reading at `loop/dispatch/loop.ts`.

### Comments

Write only the comments a reader could not do without: a reason the code cannot show and that someone would otherwise undo, such as a workaround, a deliberate omission or a rule of the domain. Do not document a class, a method or a field whose name already says it.

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

`weaver install`, run at the root of a project, writes the hooks of the agent runtimes and a starter `weaver.config.json`. `weaver doctor` checks that the wiring is alive, and `weaver uninstall` removes the hooks. To have the command on this machine, build the workspace, then link its entry into a folder of your `PATH`, for example `ln -s "$PWD/apps/cli/dist/bin/weaver.js" ~/.local/bin/weaver` from the root of this repository. The build makes the entry executable.

This is temporary. Weaver is not distributed yet, so a project is wired to this checkout by absolute paths: the hooks and the `$schema` line stop working when the checkout moves or its `dist/` is removed, and they belong to one machine. The `TODO(distribution)` in `apps/cli/src/link/engine-link.ts` marks what to replace once Weaver is published.

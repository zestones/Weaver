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
| `pnpm check`        | Run formatting, types, lint, unused-code analysis and builds sequentially.                             |

Checks run locally through `pnpm check`; no GitHub Actions workflow is configured. Recursive package commands use one workspace slot. Each package must configure its own test runner with one worker and no parallel test files. These limits reduce concurrent work; they are not a hard memory quota.

Knip discovers workspace packages from `pnpm-workspace.yaml` and tooling entry points through its plugins. `knip.json` declares the root project files without treating every file as an entry point. Add actual executable entry points when applications are implemented; do not hide unused code or dependencies with blanket exclusions.

## TypeScript and packages

`tsconfig.base.json` contains shared strictness and Node.js module resolution defaults. There is no root compilation project or root test-runner configuration.

Each Node.js package supplies its own `tsconfig.json`, extends `tsconfig.base.json`, and declares its environment types, included files, output paths and declaration emission settings. Its manifest declares a build script, a type-check script and explicit public `exports` with `types` and `import` targets pointing to emitted files. Internal dependencies use the `workspace:` protocol and are declared by the consuming package. Browser applications override the Node.js defaults with their bundler and browser settings.

Do not add TypeScript path aliases that bypass workspace manifests. Package exports restrict imports by package name; ESLint additionally rejects common imports into workspace `src` and `dist` paths. A complete dependency allowlist and restrictions on relative imports across package boundaries will be added with the first actual packages.

Tests and their Vitest configuration live inside their owning application or package. Package tests need their own no-emit TypeScript configuration and must be included in their type-check script. Browser configuration and browser tests will be introduced with the web application rather than inheriting Node.js assumptions.

There are currently no packages or tests. Recursive build, type-check and test commands have nothing to run. `pnpm check` verifies formatting, lint and unused-code analysis; its build and type-check steps will execute real work once packages are implemented. Add `pnpm test` to that command with the first package tests, and make the package test runner fail when its suite is unexpectedly empty.

## Conventions

Use explicit types at public boundaries, type-only imports and checked asynchronous operations. TypeScript rejects unchecked indexed access, ambiguous optional values, unused declarations and missing return paths. ESLint uses type information from each file's nearest TypeScript project.

Formatting uses two spaces, single quotes, no semicolons, LF endings and preserved Markdown paragraphs. Keep generated files and temporary fixtures out of version control. Documentation and code are written in English.

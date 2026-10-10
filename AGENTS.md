# Working in this repository

Read the [development guide](_docs/development.md) before writing code: it holds the commands and the conventions. The conventions most often missed:

- The source of a package is classes. No function at the top level of a module outside `lib/`, and one class per file.
- A folder holds sub-folders or files, never both. A family of files gets a sub-folder of its own.
- Write only the comments a reader could not do without. Do not document what a name already says.

Run `pnpm check` before reporting work as done: it formats, type-checks, lints, looks for unused code, builds and tests.

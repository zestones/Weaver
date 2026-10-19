import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `foreign` is a folder of the same name that someone else wrote: Weaver never writes over it, nor removes it.
export type ModState = 'absent' | 'foreign' | 'stale' | 'current'

// What the runtime loads of the mod. Its tests stay with Weaver.
const FILES = [
  '.claude-plugin/plugin.json',
  'hooks/hooks.json',
  'hooks/register.tsx',
  'hooks/end-of-task-view.ts',
  'hooks/duration.ts',
  'types/index.d.ts',
]
const MANIFEST = '.claude-plugin/plugin.json'
// What the manifest says of the folder: how Weaver knows it as its own.
const MARK = 'Weaver writes this folder with each install and update.'
// The release keeps the mod beside the command.
const SOURCE = fileURLToPath(new URL('../../mods/weaver-status/', import.meta.url))

// The mod that shows the end of a task in the chat of Claude Code while its Stop hook runs: the spinner says the step
// under way, a band above the prompt lists every step, a toast says how it ended. Claude Code loads it from the skills
// of a project it trusts, as it runs the hooks of one. Like the guide it is Weaver's: each install and update writes
// it again.
export class StatusMod {
  readonly path: string
  private readonly folder: string

  // `path` is the folder the runtime loads the mod from, from the top of the project.
  constructor(top: string, path: string) {
    this.path = path
    this.folder = join(top, path)
  }

  state(): ModState {
    if (!existsSync(this.folder)) return 'absent'
    if (!StatusMod.isWeavers(this.folder)) return 'foreign'

    return FILES.every((file) => this.holds(file)) ? 'current' : 'stale'
  }

  write(): void {
    for (const file of FILES) {
      mkdirSync(dirname(join(this.folder, file)), { recursive: true })
      writeFileSync(join(this.folder, file), readFileSync(join(SOURCE, file)))
    }
  }

  // The whole folder goes, with what the runtime wrote in it beside the mod. A folder Weaver did not write stays.
  static remove(top: string, path: string): boolean {
    const folder = join(top, path)

    if (!existsSync(folder) || !StatusMod.isWeavers(folder)) return false

    rmSync(folder, { recursive: true })

    return true
  }

  private static isWeavers(folder: string): boolean {
    const manifest = join(folder, MANIFEST)

    return existsSync(manifest) && readFileSync(manifest, 'utf8').includes(MARK)
  }

  private holds(file: string): boolean {
    const written = join(this.folder, file)

    return existsSync(written) && readFileSync(written).equals(readFileSync(join(SOURCE, file)))
  }
}

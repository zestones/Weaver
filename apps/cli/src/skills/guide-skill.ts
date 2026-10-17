import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WeaverGuide, type Declaration } from '@weaver/engine'

// `foreign` is a skill of the same name that someone else wrote: Weaver never writes over it, nor removes it.
export type GuideState = 'absent' | 'foreign' | 'stale' | 'current'

// What the guide says first under its header: how Weaver knows the file as its own.
const MARK = '<!-- Weaver writes this file with each install and update'

// The guide of Weaver as a skill a runtime lists to its agent. Unlike the skills of the project it is Weaver's: each
// install and each update writes it again, with what this Weaver does and what the project declares then.
export class GuideSkill {
  static readonly NAME = 'weaver'

  readonly path: string
  private readonly file: string
  private readonly declaration: Declaration

  // `path` is where the runtime looks for a skill named after its folder, from the top of the project.
  constructor(top: string, path: string, declaration: Declaration) {
    this.path = path
    this.file = join(top, path)
    this.declaration = declaration
  }

  get content(): string {
    return [
      '---',
      `name: ${GuideSkill.NAME}`,
      // A quoted string of JSON is one of YAML: the summary may hold a colon.
      `description: ${JSON.stringify(WeaverGuide.SUMMARY)}`,
      '---',
      '',
      `${MARK}, from what the project declares: change the project, not this file. -->`,
      '',
      new WeaverGuide(this.declaration).text,
      '',
    ].join('\n')
  }

  state(): GuideState {
    if (!existsSync(this.file)) return 'absent'

    const written = readFileSync(this.file, 'utf8')

    if (!written.includes(MARK)) return 'foreign'

    return written === this.content ? 'current' : 'stale'
  }

  write(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, this.content)
  }

  // Whatever the project declares, or fails to: its folder goes with it, once nothing else is left in it. A skill of
  // the same name that Weaver did not write stays.
  static remove(top: string, path: string): boolean {
    const file = join(top, path)

    if (!existsSync(file) || !readFileSync(file, 'utf8').includes(MARK)) return false

    rmSync(file)

    if (readdirSync(dirname(file)).length === 0) rmSync(dirname(file), { recursive: true })

    return true
  }
}

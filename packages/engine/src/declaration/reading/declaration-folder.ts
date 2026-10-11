import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Declaration } from '../content/declaration.ts'
import type { PartName } from '../schema/declaration-document.ts'
import { DeclarationParts } from './declaration-parts.ts'

// Where a project declares what Weaver holds it to. A repository is supervised as soon as the settings are there; the
// other files are optional.
export class DeclarationFolder {
  static readonly NAME = '.weaver'

  readonly path: string

  constructor(path: string) {
    this.path = path
  }

  static in(top: string): DeclarationFolder {
    return new DeclarationFolder(join(top, DeclarationFolder.NAME))
  }

  get settings(): string {
    return join(this.path, DeclarationParts.FILES.settings)
  }

  load(): Declaration | null {
    if (!existsSync(this.settings)) return null

    const written = Object.entries(DeclarationParts.FILES).flatMap(([part, file]): [PartName, string][] => {
      const path = join(this.path, file)

      return existsSync(path) ? [[part as PartName, readFileSync(path, 'utf8')]] : []
    })

    return new DeclarationParts(DeclarationFolder.NAME, Object.fromEntries(written), (path) => this.projectFile(path)).declaration()
  }

  private projectFile(path: string): string | null {
    const file = join(dirname(this.path), path)

    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }
}

import { join } from 'node:path'
import { DeclarationFolder } from '../../declaration/reading/declaration-folder.ts'
import type { Repository } from '../../lib/git/repository.ts'
import { PathsGuard } from './paths-guard.ts'

// What the project asks of its agents is not theirs to rewrite, whatever the project declares.
export class DeclarationGuard extends PathsGuard {
  constructor(repo: Repository, skills: readonly string[]) {
    super(
      {
        id: 'weaver:declaration',
        statement: "Weaver's configuration and the skills it relies on are the owner's. Describe the change you need; the owner makes it.",
        liftable: true,
      },
      repo.top,
      [join(repo.top, DeclarationFolder.NAME), ...skills.map((skill) => join(repo.top, skill))],
    )
  }
}

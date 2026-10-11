import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Declaration } from '../../src/declaration/content/declaration.ts'
import { DeclarationFolder } from '../../src/declaration/reading/declaration-folder.ts'
import { DeclarationParts, type PartTexts } from '../../src/declaration/reading/declaration-parts.ts'
import type { PartName } from '../../src/declaration/schema/declaration-document.ts'
import { writeFiles } from './repo.ts'

type Raw = Record<string, unknown>

interface Split {
  readonly texts: PartTexts
  // The other files of the project the declaration reads: the skill that lists the headings of the final message.
  readonly files: Readonly<Record<string, string>>
}

const FINISH_SKILL = '.weaver/skills/wv-finish.md'

// A test says what a project declares as one object; here it is split into the files Weaver reads it from. The
// headings a test gives for the final message go where a project writes them: in the header of its finish skill.
function split(project: Raw): Split {
  const { finish, scope, scripts, review, checks, guards } = project
  const { headings, ...limits } = (finish ?? {}) as { headings?: readonly string[]; skill?: string }
  const skill = headings === undefined ? limits.skill : (limits.skill ?? FINISH_SKILL)
  const { rules, ...reviewers } = (review ?? {}) as Raw
  const parts: Partial<Record<PartName, unknown>> = {
    settings: { version: 1, ...(finish === undefined ? {} : { finish: { ...limits, ...(skill === undefined ? {} : { skill }) } }) },
    guards,
    checks,
    scripts:
      scripts === undefined && scope === undefined
        ? undefined
        : { ...(scripts as Raw | undefined), ...(scope === undefined ? {} : { scope }) },
    reviewers: review === undefined ? undefined : reviewers,
    rules,
  }
  const header = headings === undefined ? null : ['---', 'headings:', ...headings.map((heading) => `  - ${heading}`), '---', ''].join('\n')

  return {
    texts: Object.fromEntries(
      Object.entries(parts).flatMap(([part, value]) => (value === undefined ? [] : [[part, JSON.stringify(value, null, 2)]])),
    ),
    files: skill === undefined || header === null ? {} : { [skill]: header },
  }
}

export function declarationOf(project: Raw): Declaration {
  const { texts, files } = split(project)

  return new DeclarationParts(DeclarationFolder.NAME, texts, (path) => files[path] ?? null).declaration()
}

export function declarationFiles(project: Raw): Record<string, string> {
  const { texts, files } = split(project)
  const parts = Object.entries(texts).map(([part, text]) => [`${DeclarationFolder.NAME}/${DeclarationParts.FILES[part as PartName]}`, text])

  return { ...(Object.fromEntries(parts) as Record<string, string>), ...files }
}

// Replaces whatever the repository declared.
export function writeDeclaration(top: string, project: Raw): void {
  rmSync(join(top, DeclarationFolder.NAME), { recursive: true, force: true })
  writeFiles(top, declarationFiles(project))
}

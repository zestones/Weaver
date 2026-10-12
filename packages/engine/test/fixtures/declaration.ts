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
  // The other files of the project the declaration reads: the skills whose headers list the headings of the final
  // message and the sections of a card.
  readonly files: Readonly<Record<string, string>>
}

const FINISH_SKILL = '.weaver/skills/wv-finish.md'
const CARD_SKILL = '.weaver/skills/wv-card.md'
// A file writes every limit Weaver applies. A test gives the ones it is about, and these stand for the others.
const LIMITS = { maxRefusals: 3, totalTimeoutSeconds: 1200, parallel: 3, warnTimeoutSeconds: 30 }
const CHECK = { cwd: '.', reads: 'exit', timeoutSeconds: 600 }
const REVIEW = { experiments: false, timeoutSeconds: 900, waitSeconds: 1500, maxRefusals: 1 }
const WRITER = { timeoutSeconds: 600 }

function header(name: string, listed: readonly string[]): string {
  return ['---', `${name}:`, ...listed.map((entry) => `  - ${entry}`), '---', ''].join('\n')
}

// A test says what a project declares as one object; here it is split into the files Weaver reads it from. The
// headings a test gives for the final message and the `sections` it gives the writer go where a project writes them:
// in the header of its finish skill and of the skill of its writer.
// `limits` are the ones the settings give the checks, `checks` the checks themselves.
function split(project: Raw): Split {
  const { finish, limits, scope, scripts, review, checks, guards, labels, issues, writer } = project
  const { headings, skill: named } = (finish ?? {}) as { headings?: readonly string[]; skill?: string }
  const skill = headings === undefined ? named : (named ?? FINISH_SKILL)
  const { rules, ...reviewers } = (review ?? {}) as Raw
  const { sections, ...writes } = (writer ?? {}) as { sections?: readonly string[]; skill?: string }
  const cardSkill = sections === undefined ? writes.skill : (writes.skill ?? CARD_SKILL)
  const parts: Partial<Record<PartName, unknown>> = {
    settings: { version: 2, ...(skill === undefined ? {} : { finish: { skill } }), checks: { ...LIMITS, ...(limits as Raw | undefined) } },
    guards,
    checks:
      checks === undefined
        ? undefined
        : Object.fromEntries(Object.entries(checks as Raw).map(([id, check]) => [id, { ...CHECK, ...(check as Raw) }])),
    scripts:
      scripts === undefined && scope === undefined
        ? undefined
        : { ...(scripts as Raw | undefined), ...(scope === undefined ? {} : { scope }) },
    labels,
    issues,
    reviewers: review === undefined ? undefined : { ...REVIEW, ...reviewers },
    rules,
    writer: writer === undefined ? undefined : { ...WRITER, ...writes, ...(cardSkill === undefined ? {} : { skill: cardSkill }) },
  }

  return {
    texts: Object.fromEntries(
      Object.entries(parts).flatMap(([part, value]) => (value === undefined ? [] : [[part, JSON.stringify(value, null, 2)]])),
    ),
    files: {
      ...(skill === undefined || headings === undefined ? {} : { [skill]: header('headings', headings) }),
      ...(cardSkill === undefined || sections === undefined ? {} : { [cardSkill]: header('sections', sections) }),
    },
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

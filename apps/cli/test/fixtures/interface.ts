import type { Key } from 'ink'
import { CardDesk } from '../../src/cards/card-desk.ts'
import { Paint } from '../../src/output/paint.ts'
import { Project } from '../../src/project/project.ts'
import { UiModel } from '../../src/ui/model/ui-model.ts'
import { finding, flag, inRegistry, note, write } from './cards.ts'
import { makeProject, SETTINGS, writeConfig } from './project.ts'

const NO_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
}
type Named = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab' | 'back'
const NAMED: Readonly<Record<Named, keyof Key>> = {
  up: 'upArrow',
  down: 'downArrow',
  left: 'leftArrow',
  right: 'rightArrow',
  enter: 'return',
  esc: 'escape',
  tab: 'tab',
  back: 'backspace',
}

const LABELS = {
  level: { critical: 'Happening today', high: 'Breaks a function', medium: 'Breaks it sometimes', low: 'Changes nothing for a user' },
  area: { api: 'The API', client: 'The client' },
  type: { bug: 'Does not work as specified', debt: 'To pay down' },
}
// The moment the interface of these tests takes for now: ages are counted from it.
const NOW = new Date('2026-10-11T13:00:00.000Z')

// A project whose registry holds five cards:
//   1  written, a bug of the API, high
//   2  written, a debt of the client, low
//   3  a finding of a review, which has no label
//   4  written, a bug of the API, critical, on which an agent reported that it fixed it
//   5  written, and closed as wontfix
export function makeInterfaceProject(top: string): string {
  makeProject(top)
  writeConfig(top, { settings: SETTINGS, labels: LABELS })
  flag(top)
  write(top, 1, { labels: { type: ['bug'], area: ['api'], level: ['high'] } })
  flag(top, {
    text: 'Seen: the cache is never emptied.\nExpected: x.\nFound: y.\nChecked: z.\nDid: left as it is.',
    places: [{ file: 'src/cache.ts', line: 3 }],
  })
  write(top, 2, { title: 'The cache is never emptied', labels: { type: ['debt'], area: ['client'], level: ['low'] } })
  finding(top)
  flag(top, {
    text: 'Seen: tokens are logged.\nExpected: x.\nFound: y.\nChecked: z.\nDid: left as it is.',
    places: [{ file: 'src/log.ts', line: 9 }],
  })
  write(top, 4, { title: 'Tokens are written to the log', labels: { type: ['bug'], area: ['api'], level: ['critical'] } })
  note(top, 4, {
    conclusion: 'fixed',
    text: 'Changed: removed the line that logged it, in `src/log.ts`.\nVerified: logged in, and read the log: no token in it.\nLeft: nothing.',
  })
  flag(top, { text: 'Seen: a comment is out of date.\nExpected: x.\nFound: y.\nChecked: z.\nDid: left as it is.', places: [] })
  write(top, 5, { title: 'A comment is out of date', labels: { type: ['debt'], level: ['low'] } })
  inRegistry(top, (registry) => registry.closeCard(5, 'wontfix', 'not worth a change'))

  return top
}

// The model of the interface over a project, with the registry it keeps open: close it when the test is done.
export function openInterface(top: string): { readonly model: UiModel; readonly close: () => void } {
  const project = Project.locate(top)
  const registry = project.registry()

  return { model: new UiModel(new CardDesk(project, registry), 'shop', new Paint(false), () => NOW), close: () => registry.close() }
}

// Keys given to the model as the owner presses them: a letter, the name of a key, `ctrl+s`, or `type:some words`.
export function press(model: UiModel, ...keys: readonly string[]): void {
  for (const word of keys) {
    if (word.startsWith('type:')) for (const letter of word.slice('type:'.length)) model.press(letter, NO_KEY)
    else if (word.startsWith('ctrl+')) model.press(word.slice('ctrl+'.length), { ...NO_KEY, ctrl: true })
    else if (word === 'space') model.press(' ', NO_KEY)
    else if (word in NAMED) model.press('', { ...NO_KEY, [NAMED[word as Named]]: true })
    else model.press(word, NO_KEY)
  }
}

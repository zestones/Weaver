import { CardListing, type Card, type CardOrder, type LabelCatalog } from '@weaver/memory'
import type { Key } from 'ink'
import type { CardDesk } from '../../cards/card-desk.ts'
import { WrappedLines } from '../../markdown/wrapped-lines.ts'
import { InlineMarkdown } from '../../markdown/inline-markdown.ts'
import type { Paint } from '../../output/paint.ts'
import { CloseForm } from '../forms/close-form.ts'
import { FilterForm, type Since } from '../forms/filter-form.ts'
import type { Form } from '../forms/form.ts'
import { HelpForm } from '../forms/help-form.ts'
import { LabelsForm } from '../forms/labels-form.ts'
import { NoteForm } from '../forms/note-form.ts'
import { TypedText } from '../forms/typed-text.ts'
import { CardSheet } from '../sheet/card-sheet.ts'
import { CardSides, type SheetTab } from '../sheet/card-sides.ts'
import { ListWindow } from './list-window.ts'

// The cards a view shows: those that wait, those of them someone concluded on, the closed ones, or every card.
export type View = 'open' | 'answered' | 'closed' | 'all'

interface Size {
  readonly columns: number
  readonly rows: number
}

interface Said {
  readonly text: string
  readonly problem: boolean
}

const VIEWS: readonly View[] = ['open', 'answered', 'closed', 'all']
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_DAYS = 7
// The list takes about a third of the screen, between what a title needs and what a wide screen can spare.
const LIST_SHARE = 0.32
const LIST_NARROWEST = 40
const LIST_WIDEST = 60
// The room left empty so that nothing stands against an edge: beside the screen and above it, between the two panes,
// and inside each pane between its border and what it holds. The keys are the last line of the screen. The detail is given more of it on a screen that has the columns.
const MARGIN = { across: 2, above: 1 }
const BETWEEN_PANES = 2
const INSIDE_PANE = { across: 1, down: 1 }
const INSIDE_DETAIL = 4
const INSIDE_DETAIL_NARROW = 2
const WIDE = 130
const BORDER = 2
// What stands around the two panes, the margin apart: the bar above and the keys below, each a line away.
const AROUND_PANES = 4
// Inside the pane of the list, above its cards: its heading and the line under it.
const LIST_HEAD = 2
// Inside the pane of the detail, above the side of the card that scrolls, but for its title: who flagged it, a
// line, its labels, a line, its sides, the rule under them and a line.
const SHEET_HEAD = 7
const TITLE_LINES = 2
const PAGE = 10

// What the interface shows and what each key does to it. It decides nothing about the cards: it asks the desk,
// which the commands ask too, and draws what the registry holds afterwards.
export class UiModel {
  static readonly VIEWS = VIEWS

  view: View = 'open'
  // Whether the cards stand under headings: their level, or how they were closed in the view of the closed ones.
  headed = true
  labels: Readonly<Record<string, readonly string[]>> = {}
  since: Since = 'ever'
  words = new TypedText()
  // Whether the keys go to the search.
  searching = false
  focus: 'list' | 'detail' = 'list'
  // The side of the card in sight. It is kept from card to card: going down the list reads the same side of each.
  tab: SheetTab = 'card'
  box: Form | null = null
  said: Said | null = null
  finished = false

  readonly project: string
  private readonly desk: CardDesk
  private readonly paint: Paint
  private readonly now: () => Date
  private all: Card[]
  private chosen: number | null = null
  private cursor = 0
  private first = 0
  private scroll = 0
  private size: Size = { columns: 120, rows: 36 }
  // The side of a card drawn last: drawing reads Markdown and colours code, which no key needs done twice.
  private drawn: { readonly of: Card['record']; readonly tab: SheetTab; readonly width: number; readonly lines: string[] } | null = null

  // `project` is the name the interface shows beside its own; `now` is the clock ages are counted from.
  constructor(desk: CardDesk, project: string, paint: Paint, now: () => Date = () => new Date()) {
    this.desk = desk
    this.project = project
    this.paint = paint
    this.now = now
    this.all = desk.cards()
    this.settle()
  }

  get catalog(): LabelCatalog {
    return this.desk.labels
  }

  get scale(): readonly string[] {
    return this.desk.scale
  }

  // The families of labels of the project, in the order they are shown.
  get families(): readonly string[] {
    return this.desk.families.ordered
  }

  // The cards of the list, narrowed and in order.
  get listed(): readonly Card[] {
    return this.listingOf(this.view)
      .narrowed({ labels: this.labels, since: this.momentOf(this.since), words: this.words.text })
      .ordered(this.order)
  }

  get selected(): Card | null {
    return this.listed[this.cursor] ?? null
  }

  countOf(view: View): number {
    return this.listingOf(view).cards.length
  }

  // Where a card stands on the scale of the project: 0 for the gravest value.
  rankOf(card: Card): number {
    return new CardListing([], this.scale).rankOf(card)
  }

  // How long ago a card was made.
  ageOf(card: Card): string {
    return this.agoOf(card.record.provenance.at)
  }

  // How long ago a moment was, in the largest unit that fits: minutes, hours or days.
  agoOf(moment: string): string {
    const minutes = Math.max(0, Math.floor((this.now().getTime() - new Date(moment).getTime()) / 60_000))

    if (minutes < 60) return `${String(minutes)}m`

    return minutes < 24 * 60 ? `${String(Math.floor(minutes / 60))}h` : `${String(Math.floor(minutes / (24 * 60)))}d`
  }

  resized(columns: number, rows: number): void {
    this.size = { columns, rows }
    this.settle()
  }

  get columns(): number {
    return this.size.columns
  }

  // How wide the pane of the list is, its border included.
  get listWidth(): number {
    return Math.min(LIST_WIDEST, Math.max(LIST_NARROWEST, Math.round(this.size.columns * LIST_SHARE)))
  }

  get paneHeight(): number {
    return Math.max(8, this.size.rows - AROUND_PANES - MARGIN.above)
  }

  // The room the screen leaves empty, for the components that draw it.
  get room(): {
    readonly margin: { readonly across: number; readonly above: number }
    readonly between: number
    readonly inside: { readonly across: number; readonly down: number }
    readonly detail: number
  } {
    return {
      margin: MARGIN,
      between: BETWEEN_PANES,
      inside: INSIDE_PANE,
      detail: this.size.columns >= WIDE ? INSIDE_DETAIL : INSIDE_DETAIL_NARROW,
    }
  }

  // How many lines of cards the pane of the list holds.
  private get listHeight(): number {
    return this.paneHeight - BORDER - INSIDE_PANE.down * 2 - LIST_HEAD
  }

  // The rows of the list that fit in its pane.
  get window(): ListWindow {
    return new ListWindow(this.listed, this.headingOf, this.chosen, this.first, this.listHeight)
  }

  // The order the cards are in. The closed ones are told apart by how they were closed, which is what the owner
  // looks for among them; the others by their level, in a project that grades its cards.
  get order(): CardOrder {
    if (!this.headed) return 'newest'
    if (this.view === 'closed') return 'closing'

    return this.scale.length === 0 ? 'newest' : 'level'
  }

  // Whether the cards stand under headings.
  get grouped(): boolean {
    return this.order !== 'newest'
  }

  // The heading a card stands under, as a place among the headings; null when the cards have none.
  private get headingOf(): ((card: Card) => number) | null {
    const listing = new CardListing([], this.scale)

    if (this.order === 'newest') return null

    return this.order === 'closing' ? (card) => listing.closingRankOf(card) : (card) => listing.rankOf(card)
  }

  // How wide what is written in the detail may be.
  get sheetWidth(): number {
    return Math.max(20, this.size.columns - MARGIN.across * 2 - this.listWidth - BETWEEN_PANES - BORDER - this.room.detail * 2)
  }

  // The title of the selected card, folded on two lines at most.
  get title(): readonly string[] {
    const card = this.selected

    if (card === null) return []

    const lines = new WrappedLines(this.sheetWidth).of(new InlineMarkdown(this.paint).typed(card.title))

    return lines.length <= TITLE_LINES
      ? lines
      : [...lines.slice(0, TITLE_LINES - 1), `${(lines[TITLE_LINES - 1] ?? '').slice(0, this.sheetWidth - 1)}…`]
  }

  // The lines of the side of the card in sight, and how many lines stand above them.
  get sheet(): { readonly lines: readonly string[]; readonly above: number; readonly below: number } {
    const lines = this.sheetLines()
    const height = this.sheetHeight
    const above = Math.min(this.scroll, Math.max(0, lines.length - height))

    return { lines: lines.slice(above, above + height), above, below: Math.max(0, lines.length - above - height) }
  }

  get sheetHeight(): number {
    return Math.max(3, this.paneHeight - BORDER - INSIDE_PANE.down * 2 - SHEET_HEAD - Math.max(1, this.title.length))
  }

  press(input: string, key: Key): void {
    this.said = null

    if (this.box !== null) this.pressedInBox(input, key)
    else if (this.searching) this.pressedInSearch(input, key)
    else if (this.focus === 'detail') this.pressedInDetail(input, key)
    else this.pressedInList(input, key)

    this.settle()
  }

  // What the owner saved in their editor, for the note being written.
  edited(text: string): void {
    if (this.box instanceof NoteForm) this.box = this.box.edited(text)
  }

  private pressedInList(input: string, key: Key): void {
    const cards = this.listed

    if (key.upArrow || input === 'k') this.move(-1, cards)
    else if (key.downArrow || input === 'j') this.move(1, cards)
    else if (key.pageUp) this.move(-PAGE, cards)
    else if (key.pageDown) this.move(PAGE, cards)
    else if (key.home || input === 'g') this.move(-cards.length, cards)
    else if (key.end || input === 'G') this.move(cards.length, cards)
    else if (key.leftArrow || key.rightArrow) this.turn(key.rightArrow ? 1 : -1)
    else if ((key.return || key.tab) && this.selected !== null) this.focus = 'detail'
    else this.pressedAnywhere(input)
  }

  private pressedInDetail(input: string, key: Key): void {
    const most = Math.max(0, this.sheetLines().length - this.sheetHeight)
    const at = Math.min(this.scroll, most)

    if (key.escape || key.tab) this.focus = 'list'
    else if (key.upArrow || input === 'k') this.scroll = Math.max(0, at - 1)
    else if (key.downArrow || input === 'j') this.scroll = Math.min(most, at + 1)
    else if (key.pageUp) this.scroll = Math.max(0, at - this.sheetHeight)
    else if (key.pageDown || input === ' ') this.scroll = Math.min(most, at + this.sheetHeight)
    else if (key.home || input === 'g') this.scroll = 0
    else if (key.end || input === 'G') this.scroll = most
    else if (key.leftArrow || key.rightArrow) this.turnSide(key.rightArrow ? 1 : -1)
    else this.pressedAnywhere(input)
  }

  // The keys that do the same in the list and in the detail.
  private pressedAnywhere(input: string): void {
    const card = this.selected
    const tab = CardSides.TABS[Number(input) - 1]

    if (input === 'q') this.finished = true
    else if (input === '?') this.box = new HelpForm()
    else if (input === '/') this.searching = true
    else if (input === 's') this.headed = !this.headed
    else if (input === 'f') this.box = FilterForm.for(this.catalog, this.listingOf(this.view), this.labels, this.since)
    else if (tab !== undefined && card !== null) this.show(tab)
    else if (card === null) return
    else if (input === 'c') this.box = card.isWaiting ? CloseForm.for(card) : null
    else if (input === 'n') this.box = card.state === 'merged' ? null : NoteForm.for(card)
    else if (input === 'l') this.box = card.record.written === null ? null : LabelsForm.for(card, this.catalog)

    if (card !== null && this.box === null) this.said = this.unable(input, card)
  }

  // Why a key did nothing on this card, when it is one of those that act on a card.
  private unable(input: string, card: Card): Said | null {
    if (input === 'c' && !card.isWaiting)
      return { text: `Card #${String(card.number)} is ${card.standing}: there is nothing to close.`, problem: true }
    if (input === 'n' && card.state === 'merged')
      return { text: `Card #${String(card.number)} is ${card.standing}: write on that one.`, problem: true }
    if (input === 'l' && card.record.written === null)
      return { text: `Card #${String(card.number)} has no labels to change: no writer wrote it up.`, problem: true }

    return null
  }

  private pressedInSearch(input: string, key: Key): void {
    if (key.return) this.searching = false
    else if (key.escape) {
      this.searching = false
      this.words = new TypedText()
    } else this.words = this.words.pressed(input, key) ?? this.words
  }

  private pressedInBox(input: string, key: Key): void {
    const box = this.box?.pressed(input, key) ?? null

    this.box = box

    if (box === null || box.outcome === 'cancelled') this.box = null
    else if (box.outcome === 'submitted') this.box = this.done(box)
  }

  // What a box asked for is done; the box stays, with what went wrong, when it could not be.
  private done(box: Form): Form | null {
    try {
      if (box instanceof FilterForm) {
        this.labels = box.chosen
        this.since = box.since
      } else if (box instanceof CloseForm) {
        this.say(this.desk.close(box.card.number, box.closing, box.reason.text.trim() === '' ? null : box.reason.text))
      } else if (box instanceof NoteForm) {
        this.say(`Note written on card #${String(this.desk.note(box.card.number, box.conclusion, box.text.text).number)}.`)
      } else if (box instanceof LabelsForm) {
        const labels = this.desk.relabel(box.card.number, box.chosen).labels()

        this.say(`Card #${String(box.card.number)} is now labelled ${labels.length === 0 ? 'with nothing' : labels.join(', ')}.`)
      }

      this.all = this.desk.cards()

      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return box.refused(`${message.charAt(0).toUpperCase()}${message.slice(1).replace(/\.$/, '')}.`)
    }
  }

  private say(text: string): void {
    this.said = { text, problem: false }
  }

  private move(by: number, cards: readonly Card[]): void {
    this.cursor = Math.min(Math.max(0, cards.length - 1), Math.max(0, this.cursor + by))
    this.chosen = cards[this.cursor]?.number ?? null
    this.scroll = 0
  }

  private turn(by: number): void {
    this.view = VIEWS[(VIEWS.indexOf(this.view) + by + VIEWS.length) % VIEWS.length] ?? 'open'
    this.cursor = 0
    this.chosen = null
    this.first = 0
  }

  private turnSide(by: number): void {
    const tabs = CardSides.TABS

    this.show(tabs[(tabs.indexOf(this.tab) + by + tabs.length) % tabs.length] ?? 'card')
  }

  private show(tab: SheetTab): void {
    this.tab = tab
    this.scroll = 0
  }

  // The selected card follows the list: it stays the same card while that card is listed, and becomes the one that
  // took its place when it left, as a card closed in the view of the open ones does.
  private settle(): void {
    const cards = this.listed
    const kept = this.chosen === null ? -1 : cards.findIndex((card) => card.number === this.chosen)
    const before = this.chosen

    this.cursor = kept === -1 ? Math.min(this.cursor, Math.max(0, cards.length - 1)) : kept
    this.chosen = cards[this.cursor]?.number ?? null
    this.first = ListWindow.startFor(cards, this.headingOf, this.cursor, this.first, this.listHeight)

    if (this.chosen !== before) this.scroll = 0
    if (this.chosen === null) this.focus = 'list'
  }

  private listingOf(view: View): CardListing {
    const cards = this.all.filter((card) => (view === 'all' ? true : view === 'closed' ? card.state === 'closed' : card.isWaiting))

    return new CardListing(cards, this.scale).narrowed({ answered: view === 'answered' })
  }

  // The moment a filter goes back to; null when it goes back to the first card.
  momentOf(since: Since): string | null {
    const now = this.now()
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    if (since === 'ever') return null

    return (since === 'today' ? day : new Date(day.getTime() - (WEEK_DAYS - 1) * DAY_MS)).toISOString()
  }

  private sheetLines(): string[] {
    const card = this.selected
    const width = this.sheetWidth

    if (card === null) return []
    if (this.drawn?.of !== card.record || this.drawn.tab !== this.tab || this.drawn.width !== width) {
      this.drawn = { of: card.record, tab: this.tab, width, lines: new CardSheet(card, this.paint, width).lines(this.tab) }
    }

    return this.drawn.lines
  }
}

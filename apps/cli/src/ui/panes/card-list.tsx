import { LabelFamilies, type Card } from '@weaver/memory'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { ListRow } from '../model/list-window.ts'
import type { UiModel } from '../model/ui-model.ts'
import { ClosedAs } from '../parts/closed-as.ts'
import { Framed } from '../parts/framed.tsx'
import { Level } from '../parts/level.ts'
import { Pill } from '../parts/pill.tsx'
import { CONCLUDED, TONES } from '../theme/marks.ts'
import { THEME } from '../theme/theme.ts'

// What stands between the edge of the pane and the text of a row, on both sides: the border, the room inside the
// pane and the room of the row.
const AROUND_ROW = 6

interface Props {
  readonly model: UiModel
}

interface RowProps {
  readonly model: UiModel
  readonly card: Card
  readonly chosen: boolean
  // How wide the numbers of the cards are, so that their titles start in one column.
  readonly numbers: number
}

// A card in two lines: its number and its title, then what someone concluded of it, its labels and its age.
function CardRow({ model, card, chosen, numbers }: RowProps): ReactNode {
  const concluded = card.conclusion
  // Under its title a card says where it is, in a project that declares areas. In another one it says every label
  // it carries, but for the level it already stands under.
  const labels = model.families.includes(LabelFamilies.AREA)
    ? card.valuesOf(LabelFamilies.AREA)
    : Object.entries(card.record.written?.labels ?? {}).flatMap(([family, values]) =>
        model.order === 'level' && family === LabelFamilies.LEVEL ? [] : values,
      )
  const closing = card.record.closing
  // Under how they were closed, the cards say when: how they stand is their heading.
  const underClosing = model.order === 'closing' && closing !== null

  return (
    <Box flexDirection='column' paddingX={1} backgroundColor={chosen ? THEME.raised : THEME.panel}>
      <Box gap={1} height={1}>
        <Box flexShrink={0} width={numbers}>
          <Text color={chosen ? THEME.gold : THEME.muted}>{`#${String(card.number)}`}</Text>
        </Box>
        <Text bold={chosen} color={THEME.ivory} wrap='truncate-end'>
          {card.title}
        </Text>
      </Box>
      <Box gap={1} height={1} paddingLeft={numbers + 1}>
        {concluded === null ? null : <Pill tone={CONCLUDED[concluded.as].tone}>{`${CONCLUDED[concluded.as].mark} ${concluded.as}`}</Pill>}
        {card.isWaiting || underClosing ? null : <Pill tone='quiet'>{card.standing}</Pill>}
        <Box flexGrow={1} flexShrink={1} overflow='hidden' height={1}>
          <Text color={THEME.muted} wrap='truncate-end'>
            {labels.join(', ')}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={THEME.muted}>{underClosing ? model.agoOf(closing.at) : model.ageOf(card)}</Text>
        </Box>
      </Box>
    </Box>
  )
}

function Row({ model, row, numbers }: { readonly model: UiModel; readonly row: ListRow; readonly numbers: number }): ReactNode {
  if (row.kind === 'card') return <CardRow model={model} card={row.card} chosen={row.chosen} numbers={numbers} />
  if (row.kind === 'more') return <Text color={THEME.muted}>{` ${row.above ? '↑' : '↓'} ${String(row.count)} more`}</Text>

  const level = model.order === 'closing' ? new ClosedAs(row.rank) : new Level(model.scale, row.rank)
  const count = String(row.count)
  const rule = Math.max(0, model.listWidth - AROUND_ROW - level.name.length - count.length - 2)

  // The name of a level or of a way of closing, how many cards it holds, and a rule to the edge of the pane: it
  // reads as the heading of the cards under it.
  return (
    <Box gap={1} paddingX={1} height={1}>
      <Text bold color={TONES[level.tone].ink}>
        {level.name}
      </Text>
      <Text color={THEME.muted}>{count}</Text>
      <Text color={THEME.line}>{'─'.repeat(rule)}</Text>
    </Box>
  )
}

// The pane on the left: the cards of the view, one under the other, under the name of their level when they are put
// in that order.
export function CardList({ model }: Props): ReactNode {
  const cards = model.listed
  const rows = model.window.rows
  const numbers = Math.max(3, ...cards.map((card) => String(card.number).length + 1))
  const narrowed = model.words.text !== '' || model.since !== 'ever' || Object.values(model.labels).some((values) => values.length > 0)

  return (
    <Framed
      lit={model.focus === 'list'}
      flexDirection='column'
      flexShrink={0}
      width={model.listWidth}
      height={model.paneHeight}
      paddingX={model.room.inside.across}
      paddingY={model.room.inside.down}
      overflow='hidden'
    >
      <Box paddingX={1} gap={1} height={1}>
        <Text bold color={THEME.ivory}>
          Cards
        </Text>
        <Text color={THEME.muted}>{String(cards.length)}</Text>
        <Box flexGrow={1} />
        <Text color={THEME.muted}>
          {model.order === 'level' ? 'by level ↓' : model.order === 'closing' ? 'by closing ↓' : 'newest first'}
        </Text>
      </Box>
      <Box height={1} />
      {cards.length === 0 ? (
        <Box paddingX={1}>
          <Text color={THEME.muted}>
            {narrowed ? 'No card matches.' : model.view === 'open' ? 'Nothing waits for you.' : 'No card here.'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection='column' gap={1}>
          {rows.map((row) => (
            <Row
              key={
                row.kind === 'card'
                  ? `card-${String(row.card.number)}`
                  : row.kind === 'group'
                    ? `group-${String(row.rank)}`
                    : `more-${String(row.above)}`
              }
              model={model}
              row={row}
              numbers={numbers}
            />
          ))}
        </Box>
      )}
    </Framed>
  )
}

import { LabelFamilies, PlaceText, type Card } from '@weaver/memory'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { UiModel } from '../model/ui-model.ts'
import { Framed } from '../parts/framed.tsx'
import { Level } from '../parts/level.ts'
import { Pill } from '../parts/pill.tsx'
import type { SheetTab } from '../sheet/card-sheet.ts'
import { CONCLUDED } from '../theme/marks.ts'
import { THEME } from '../theme/theme.ts'

const FOUND: Readonly<Record<Card['origin'], string>> = { flag: 'flagged', owner: 'flagged', finding: 'found', suspicion: 'suspected' }
const TAB_NAMES: Readonly<Record<SheetTab, string>> = { card: 'Card', flag: 'Flag', notes: 'Notes' }
const TAB_GAP = 3

interface Props {
  readonly model: UiModel
}

// The sides of a card, the one in sight underlined in gold, the rule going on under the others.
function Tabs({ model, card }: { readonly model: UiModel; readonly card: Card }): ReactNode {
  const notes = card.record.notes.length
  // How many notes the card holds stands on a chip beside the name of their side.
  const count = notes === 0 ? '' : ` ${String(notes)} `
  const widths = UiModel.TABS.map((tab) => TAB_NAMES[tab].length + (tab === 'notes' && count !== '' ? 1 + count.length : 0))
  const at = UiModel.TABS.indexOf(model.tab)
  const before = widths.slice(0, at).reduce((sum, width) => sum + width + TAB_GAP, 0)
  const under = TAB_NAMES[model.tab].length
  const { above, below } = model.sheet

  return (
    <Box flexDirection='column'>
      <Box gap={TAB_GAP} height={1}>
        {UiModel.TABS.map((tab) => (
          <Box key={tab} flexShrink={0} gap={1}>
            <Text bold={tab === model.tab} color={tab === model.tab ? THEME.ivory : THEME.muted}>
              {TAB_NAMES[tab]}
            </Text>
            {tab === 'notes' && count !== '' ? (
              <Text color={THEME.ivory} backgroundColor={THEME.chip}>
                {count}
              </Text>
            ) : null}
          </Box>
        ))}
        <Box flexGrow={1} />
        <Text color={THEME.muted}>
          {[...(above > 0 ? [`↑ ${String(above)}`] : []), ...(below > 0 ? [`↓ ${String(below)}`] : [])].join('  ')}
        </Text>
      </Box>
      <Box height={1} overflow='hidden'>
        <Text color={THEME.line}>{'─'.repeat(before)}</Text>
        <Text color={THEME.gold}>{'━'.repeat(under)}</Text>
        <Text color={THEME.line}>{'─'.repeat(Math.max(0, model.sheetWidth - before - under))}</Text>
      </Box>
    </Box>
  )
}

// The pane in the middle: the card that is selected in the list, one of its sides at a time.
export function CardDetail({ model }: Props): ReactNode {
  const card = model.selected
  const focused = model.focus === 'detail'

  if (card === null) {
    return <Framed lit={false} flexGrow={1} height={model.paneHeight} />
  }

  const { provenance, places } = card.record
  const concluded = card.conclusion
  const rank = model.rankOf(card)
  const level = rank < model.scale.length ? new Level(model.scale, rank) : null
  // The level has a pill of its own when the project grades with it. Every other label the card carries is a chip:
  // what kind of thing it is, where it is, then the rest.
  const carried = card.record.written?.labels ?? {}
  const known: readonly string[] = [LabelFamilies.LEVEL, LabelFamilies.TYPE, LabelFamilies.AREA]
  const labels = [
    LabelFamilies.TYPE,
    LabelFamilies.AREA,
    ...Object.keys(carried).filter((family) => !known.includes(family)),
    ...(level === null ? [LabelFamilies.LEVEL] : []),
  ].flatMap((family) => carried[family] ?? [])
  const who = provenance.role === 'owner' ? 'the owner' : provenance.author
  const [place] = places

  return (
    <Framed
      lit={focused}
      flexDirection='column'
      flexGrow={1}
      height={model.paneHeight}
      paddingX={model.room.detail}
      paddingY={model.room.inside.down}
      overflow='hidden'
    >
      <Box height={1}>
        <Text color={THEME.muted}>{`#${String(card.number)}`}</Text>
        <Box flexGrow={1} />
        <Text color={THEME.muted}>{`${FOUND[card.origin]} by ${who}, ${model.ageOf(card)} ago`}</Text>
      </Box>
      {model.title.map((line, index) => (
        <Text key={index} bold color={THEME.ivory} wrap='truncate-end'>
          {line}
        </Text>
      ))}
      <Box height={1} />
      <Box gap={1} height={1} overflow='hidden'>
        {level === null ? null : (
          <Pill tone={level.tone} bold>
            {level.name}
          </Pill>
        )}
        {labels.map((label) => (
          <Pill key={label} tone='neutral'>
            {label}
          </Pill>
        ))}
        {concluded === null ? null : (
          <Pill
            tone={CONCLUDED[concluded.as].tone}
          >{`${CONCLUDED[concluded.as].mark} ${concluded.as} by ${concluded.by.role === 'owner' ? 'the owner' : concluded.by.author}`}</Pill>
        )}
        {card.state === 'open' ? null : <Pill tone='quiet'>{card.state === 'raw' ? 'not written up' : card.standing}</Pill>}
        <Box flexGrow={1} />
        {place === undefined ? null : (
          <Text color={THEME.gold} wrap='truncate-start'>
            {`${PlaceText.write(place)}${places.length > 1 ? ` +${String(places.length - 1)}` : ''}`}
          </Text>
        )}
      </Box>
      <Box height={1} />
      <Tabs model={model} card={card} />
      <Box height={1} />
      {model.sheet.lines.map((line, index) => (
        <Text key={index} color={THEME.ivory} wrap='truncate-end'>
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </Framed>
  )
}

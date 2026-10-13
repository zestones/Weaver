import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { FilterForm } from '../forms/filter-form.ts'
import type { UiModel, View } from '../model/ui-model.ts'
import { Keycap } from '../parts/keycap.tsx'
import { THEME } from '../theme/theme.ts'
import { BoxFrame } from './box-frame.tsx'

// The cards a view holds, as the box names them.
const VIEWED: Readonly<Record<View, string>> = {
  open: 'the open cards',
  answered: 'the cards someone concluded on',
  closed: 'the closed cards',
  all: 'every card',
}
const COLUMN_WIDTH = 20
const SINCE_WIDTH = 14
const FRAME = 6

interface Props {
  readonly model: UiModel
  readonly form: FilterForm
}

// Narrowing the list: the values wanted in each family, with how many cards of the view carry each, and how far
// back the cards go.
export function FilterBox({ model, form }: Props): ReactNode {
  const matching = form.listing.narrowed({ labels: form.chosen, since: model.momentOf(form.since) }).cards.length
  const width = Math.max(52, form.families.length * COLUMN_WIDTH + SINCE_WIDTH + FRAME)

  return (
    <BoxFrame title='Filter' about={VIEWED[model.view]} width={width}>
      <Box>
        {form.families.map((family, column) => {
          const held = form.chosen[family] ?? []
          const counts = form.listing.counts(family)

          return (
            <Box key={family} flexDirection='column' width={COLUMN_WIDTH} flexShrink={0}>
              <Box paddingX={1} height={1}>
                <Text color={column === form.column ? THEME.gold : THEME.muted}>{family.toUpperCase()}</Text>
              </Box>
              {form.valuesOf(family).map((value, row) => {
                const on = held.includes(value)
                const here = column === form.column && row === form.row

                return (
                  <Box key={value} gap={1} height={1} paddingX={1} backgroundColor={here ? THEME.raised : THEME.panel}>
                    <Box width={1} flexShrink={0}>
                      <Text color={THEME.gold}>{on ? '✓' : ' '}</Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1} overflow='hidden' height={1}>
                      <Text bold={here} color={on || here ? THEME.ivory : THEME.muted} wrap='truncate-end'>
                        {value}
                      </Text>
                    </Box>
                    <Text color={THEME.muted}>{String(counts[value] ?? 0)}</Text>
                  </Box>
                )
              })}
            </Box>
          )
        })}
        <Box flexDirection='column' width={SINCE_WIDTH} flexShrink={0}>
          <Box paddingX={1} height={1}>
            <Text color={form.onSince ? THEME.gold : THEME.muted}>SINCE</Text>
          </Box>
          {FilterForm.SINCE.map((since, row) => {
            const on = since === form.since
            const here = form.onSince && row === form.row

            return (
              <Box key={since} gap={1} height={1} paddingX={1} backgroundColor={here ? THEME.raised : THEME.panel}>
                <Text color={on ? THEME.gold : THEME.muted}>{on ? '●' : '○'}</Text>
                <Text bold={here} color={on || here ? THEME.ivory : THEME.muted}>
                  {FilterForm.SINCE_NAMES[since]}
                </Text>
              </Box>
            )
          })}
        </Box>
      </Box>
      <Box height={1} />
      <Box gap={1} height={1}>
        <Text bold color={THEME.ground} backgroundColor={THEME.gold}>{` ${String(matching)} ${matching === 1 ? 'card' : 'cards'} `}</Text>
        <Text color={THEME.muted}>{matching === 1 ? 'matches' : 'match'}</Text>
        <Box flexGrow={1} />
        <Box gap={3}>
          <Keycap cap='space'>Toggle</Keycap>
          <Keycap cap='x'>Clear</Keycap>
          <Keycap cap='enter'>Apply</Keycap>
        </Box>
      </Box>
    </BoxFrame>
  )
}

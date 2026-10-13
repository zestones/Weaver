import { LabelFamilies } from '@weaver/memory'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { LabelsForm } from '../forms/labels-form.ts'
import type { UiModel } from '../model/ui-model.ts'
import { Keycap } from '../parts/keycap.tsx'
import { Level } from '../parts/level.ts'
import { TONES } from '../theme/marks.ts'
import { THEME } from '../theme/theme.ts'
import { BoxFrame } from './box-frame.tsx'

const COLUMN_WIDTH = 20
const FRAME = 6

interface Props {
  readonly model: UiModel
  readonly form: LabelsForm
}

// The labels of a card, a family of the project in each column. A family that takes one value shows a round mark
// on the one it has; the others tick as many as fit. A level is marked in its own colour.
export function LabelsBox({ model, form }: Props): ReactNode {
  const focused = form.focused
  const width = Math.max(48, form.families.length * COLUMN_WIDTH + FRAME)
  // The colour a value is said in: its own for a level that says how grave, the gold of the theme for the others.
  const inkOf = (family: string, row: number): string => {
    const tone = family === LabelFamilies.LEVEL ? new Level(model.scale, row).tone : null

    return tone === 'coral' || tone === 'orange' ? TONES[tone].ink : THEME.gold
  }

  return (
    <BoxFrame title='Labels' card={form.card} width={width} problem={form.problem}>
      {focused === null ? (
        <Text color={THEME.muted}>This project declares no label.</Text>
      ) : (
        <>
          <Box>
            {form.families.map((family, column) => {
              const held = form.chosen[family] ?? []
              const one = form.takesOne(family)

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
                          <Text color={on ? inkOf(family, row) : THEME.muted}>{one ? (on ? '●' : '○') : on ? '✓' : ' '}</Text>
                        </Box>
                        <Text bold={on || here} color={on || here ? THEME.ivory : THEME.muted} wrap='truncate-end'>
                          {value}
                        </Text>
                      </Box>
                    )
                  })}
                </Box>
              )
            })}
          </Box>
          <Box height={1} />
          <Text color={THEME.line}>{'─'.repeat(width - FRAME)}</Text>
          <Text color={THEME.muted} wrap='wrap'>
            <Text bold color={inkOf(focused.family, form.row) === THEME.gold ? THEME.ivory : inkOf(focused.family, form.row)}>
              {focused.value}
            </Text>
            {focused.meaning === '' ? '' : ` ${focused.meaning.charAt(0).toLowerCase()}${focused.meaning.slice(1)}`}
          </Text>
          <Box height={1} />
          <Box gap={3}>
            <Keycap cap='←→ ↑↓'>Move</Keycap>
            <Keycap cap='space'>Set</Keycap>
            <Keycap cap='enter'>Save</Keycap>
          </Box>
        </>
      )}
    </BoxFrame>
  )
}

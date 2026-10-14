import type { Card } from '@weaver/memory'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { Framed } from '../parts/framed.tsx'
import { THEME } from '../theme/theme.ts'

const SIDES = 2

interface Props {
  // What the box does, in a word, then the card it does it to when it is about one.
  readonly title: string
  readonly card?: Card
  readonly about?: string
  readonly width: number
  // What went wrong when the owner asked for what the box holds.
  readonly problem?: string | null
  readonly children: ReactNode
}

// The line above a box, or under it, on a row of the box itself and at the edge of that row that looks out: nothing
// of the box lies beyond it. Its ends are the lines of the sides, which go through this row.
function Edge({ line, width }: { readonly line: string; readonly width: number }): ReactNode {
  return (
    <Box height={1}>
      <Text color={THEME.panel} backgroundColor={THEME.gold}>
        ▊
      </Text>
      <Text color={THEME.gold} backgroundColor={THEME.panel}>
        {line.repeat(Math.max(0, width - SIDES))}
      </Text>
      <Text color={THEME.gold} backgroundColor={THEME.panel}>
        ▎
      </Text>
    </Box>
  )
}

// A small box in front of the panes, which takes the keys until the owner is done with it. A pane stands on the
// ground of the screen, and its frame leaves that ground outside its line. A box stands on whatever is behind it,
// where a frame of that kind would carry a band of ground all round. So the lines above and under a box are drawn
// on its own rows, and those of its sides in the column beside it, on the ground of the pane that is behind them:
// no character draws a line above a cell and one beside it.
export function BoxFrame({ title, card, about, width, problem = null, children }: Props): ReactNode {
  return (
    <Box flexDirection='column' width={width}>
      <Edge line='▔' width={width} />
      <Framed lit on={THEME.panel} borderTop={false} borderBottom={false} flexDirection='column' paddingX={2}>
        <Box gap={1} height={1}>
          <Text bold color={THEME.ivory}>
            {title}
          </Text>
          {card === undefined ? null : <Text color={THEME.gold}>{`#${String(card.number)}`}</Text>}
          {about === undefined ? null : <Text color={THEME.muted}>{about}</Text>}
          <Box flexGrow={1} />
          <Text color={THEME.ivory} backgroundColor={THEME.chip}>
            {' esc '}
          </Text>
        </Box>
        {card === undefined ? null : (
          <Text color={THEME.muted} wrap='truncate-end'>
            {card.title}
          </Text>
        )}
        <Box height={1} />
        {children}
        {problem === null ? null : (
          <Box marginTop={1}>
            <Text color={THEME.coral.ink}>{`! ${problem}`}</Text>
          </Box>
        )}
      </Framed>
      <Edge line='▁' width={width} />
    </Box>
  )
}

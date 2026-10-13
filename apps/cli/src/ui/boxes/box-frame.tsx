import type { Card } from '@weaver/memory'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { Framed } from '../parts/framed.tsx'
import { THEME } from '../theme/theme.ts'

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

// A small box in front of the panes, which takes the keys until the owner is done with it.
export function BoxFrame({ title, card, about, width, problem = null, children }: Props): ReactNode {
  return (
    <Framed lit flexDirection='column' width={width} paddingX={2} paddingY={1}>
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
  )
}

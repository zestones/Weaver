import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { TONES, type Tone } from '../theme/marks.ts'

interface Props {
  readonly tone: Tone
  readonly bold?: boolean
  readonly children: string
}

// A word on a ground of its own. It never gives up a letter to what stands beside it.
export function Pill({ tone, bold = false, children }: Props): ReactNode {
  const { ink, ground } = TONES[tone]

  return (
    <Box flexShrink={0}>
      <Text color={ink} backgroundColor={ground} bold={bold}>{` ${children} `}</Text>
    </Box>
  )
}

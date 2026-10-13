import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { THEME } from '../theme/theme.ts'

interface Props {
  // The key as it is written on a keyboard.
  readonly cap: string
  // What it does, in a word.
  readonly children: string
}

// A key and what it does.
export function Keycap({ cap, children }: Props): ReactNode {
  return (
    <Box flexShrink={0} gap={1}>
      <Text color={THEME.ivory} backgroundColor={THEME.chip}>{` ${cap} `}</Text>
      <Text color={THEME.muted}>{children}</Text>
    </Box>
  )
}

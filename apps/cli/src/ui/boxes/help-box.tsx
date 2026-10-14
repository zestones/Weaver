import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { THEME } from '../theme/theme.ts'
import { BoxFrame } from './box-frame.tsx'

const WIDTH = 68
const KEY_WIDTH = 12
const KEYS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  [
    'THE LIST',
    [
      ['↑ ↓  j k', 'the card above, the card under'],
      ['← →', 'the view before, the view after'],
      ['enter', 'go into the card, to scroll it'],
      ['/', 'search what the cards say and why they closed'],
      ['f', 'narrow the list by labels and by date'],
      ['s', 'under their level or closing, or newest first'],
    ],
  ],
  [
    'THE CARD',
    [
      ['1 to 5', 'a side: card, flag, looked into, fixed, noted'],
      ['↑ ↓  space', 'scroll, a line or a page'],
      ['← →', 'the side before, the side after'],
      ['esc', 'back to the list'],
    ],
  ],
  [
    'WHAT YOU DO',
    [
      ['n', 'write a note on the card'],
      ['l', 'change its labels'],
      ['c', 'close it'],
      ['q', 'leave'],
    ],
  ],
]

// Every key of the interface, by where it works.
export function HelpBox(): ReactNode {
  return (
    <BoxFrame title='Keys' width={WIDTH}>
      {KEYS.map(([part, keys], index) => (
        <Box key={part} flexDirection='column' marginTop={index === 0 ? 0 : 1}>
          <Text color={THEME.muted}>{part}</Text>
          {keys.map(([cap, does]) => (
            <Box key={cap} height={1}>
              <Box width={KEY_WIDTH} flexShrink={0}>
                <Text color={THEME.gold}>{cap}</Text>
              </Box>
              <Text color={THEME.ivory}>{does}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </BoxFrame>
  )
}

import { Box, type BoxProps } from 'ink'
import type { ReactNode } from 'react'
import { THEME } from '../theme/theme.ts'

// A frame drawn at the edge of the cells, not through their middle as the lines of a box are: the ground of what it
// holds then ends exactly where the frame is. Above and under, the line is the eighth of a cell that touches the
// ground; on each side it is the quarter that does, which is about as thick. The left one is the gap a block
// leaves: no character draws the right quarter of a cell.
const EDGE = { topLeft: ' ', top: '▁', topRight: ' ', left: '▊', right: '▎', bottomLeft: ' ', bottom: '▔', bottomRight: ' ' }

interface Props extends BoxProps {
  // Whether the keys go to what the frame holds: its frame is then the gold of the theme.
  readonly lit: boolean
  readonly children?: ReactNode
}

// A pane or a box: a ground of its own, inside a frame that fits it.
export function Framed({ lit, children, ...box }: Props): ReactNode {
  const frame = lit ? THEME.gold : THEME.line

  return (
    <Box
      {...box}
      borderStyle={EDGE}
      borderTopColor={frame}
      borderBottomColor={frame}
      borderRightColor={frame}
      borderLeftColor={THEME.ground}
      borderLeftBackgroundColor={frame}
      borderTopBackgroundColor={THEME.ground}
      borderBottomBackgroundColor={THEME.ground}
      borderRightBackgroundColor={THEME.ground}
      backgroundColor={THEME.panel}
    >
      {children}
    </Box>
  )
}

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { UiModel } from '../model/ui-model.ts'
import { THEME } from '../theme/theme.ts'

type Hint = readonly [key: string, does: string]

const SEARCHING: readonly Hint[] = [
  ['enter', 'keep'],
  ['esc', 'clear'],
]
const IN_DETAIL: readonly Hint[] = [
  ['↑↓', 'scroll'],
  ['←→', 'side'],
  ['esc', 'back'],
  ['n', 'note'],
  ['l', 'label'],
  ['c', 'close'],
]
const IN_LIST: readonly Hint[] = [
  ['↑↓', 'navigate'],
  ['←→', 'view'],
  ['enter', 'open'],
  ['/', 'search'],
  ['f', 'filter'],
  ['n', 'note'],
  ['l', 'label'],
  ['c', 'close'],
]

interface Props {
  readonly model: UiModel
}

// A key and what it does, as the help of a terminal interface is written: the key, then a word.
function Hinted({ hint: [key, does] }: { readonly hint: Hint }): ReactNode {
  return (
    <Box flexShrink={0} gap={1}>
      <Text color={THEME.ivory}>{key}</Text>
      <Text color={THEME.muted}>{does}</Text>
    </Box>
  )
}

// The last line of the screen: the keys that matter where the owner is, one after the other. What the last thing
// they did came to takes their place until the next key: it is read once, and the keys are known.
export function KeyBar({ model }: Props): ReactNode {
  const said = model.said
  const hints = model.searching ? SEARCHING : model.focus === 'detail' ? IN_DETAIL : IN_LIST

  if (said !== null) {
    return (
      <Box paddingX={1} height={1}>
        <Text color={said.problem ? THEME.coral.ink : THEME.green.ink} wrap='truncate-end'>
          {`${said.problem ? '!' : '✓'} ${said.text}`}
        </Text>
      </Box>
    )
  }

  return (
    <Box paddingX={1} gap={1} height={1}>
      {hints.map((hint, index) => (
        <Box key={hint[0]} flexShrink={0} gap={1}>
          {index === 0 ? null : <Text color={THEME.faint}>·</Text>}
          <Hinted hint={hint} />
        </Box>
      ))}
      <Box flexGrow={1} />
      <Hinted hint={['?', 'help']} />
    </Box>
  )
}

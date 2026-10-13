import { Card, type Closing } from '@weaver/memory'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { CloseForm } from '../forms/close-form.ts'
import type { UiModel } from '../model/ui-model.ts'
import { Keycap } from '../parts/keycap.tsx'
import { Pill } from '../parts/pill.tsx'
import { CONCLUDED } from '../theme/marks.ts'
import { THEME } from '../theme/theme.ts'
import { BoxFrame } from './box-frame.tsx'

const MEANINGS: Readonly<Record<Closing, string>> = {
  fixed: 'it was fixed',
  wontfix: 'it will not be',
  issue: 'it becomes an issue',
  invalid: 'what it says is not true',
}
const WIDTH = 62
const NAME_WIDTH = 9

interface Props {
  readonly model: UiModel
  readonly form: CloseForm
}

// Closing a card: how it closes, one key each, and the reason, taken from what someone concluded when they did.
export function CloseBox({ model, form }: Props): ReactNode {
  const taken = form.taken

  return (
    <BoxFrame title='Close' card={form.card} width={WIDTH} problem={form.problem}>
      {Card.CLOSINGS.map((closing) => {
        const picked = closing === form.closing

        return (
          <Box key={closing} gap={2} height={1} paddingX={1} backgroundColor={picked ? THEME.raised : THEME.panel}>
            <Text bold={picked} color={picked ? THEME.ground : THEME.ivory} backgroundColor={picked ? THEME.gold : THEME.chip}>
              {` ${CloseForm.KEYS[closing]} `}
            </Text>
            <Box width={NAME_WIDTH} flexShrink={0}>
              <Text bold={picked} color={THEME.ivory}>
                {closing}
              </Text>
            </Box>
            <Text color={THEME.muted}>{MEANINGS[closing]}</Text>
          </Box>
        )
      })}
      <Box height={1} />
      <Text color={form.typing ? THEME.gold : THEME.muted}>REASON</Text>
      <Box height={1} paddingX={1} backgroundColor={THEME.ground} overflow='hidden'>
        <Text color={THEME.ivory} wrap='truncate-start'>
          {form.reason.text}
        </Text>
        {form.typing ? <Text color={THEME.gold}>█</Text> : null}
      </Box>
      {taken === null ? null : (
        <Box gap={1} height={1}>
          <Pill tone={CONCLUDED[taken.as].tone}>{`${CONCLUDED[taken.as].mark} ${taken.as}`}</Pill>
          <Text
            color={THEME.muted}
          >{`from the note of ${taken.by.role === 'owner' ? 'the owner' : taken.by.author}, ${model.agoOf(taken.by.at)} ago`}</Text>
        </Box>
      )}
      <Box height={1} />
      <Box gap={3}>
        <Keycap cap='enter'>Close</Keycap>
        <Keycap cap='tab'>{form.typing ? 'How it closes' : 'Reason'}</Keycap>
      </Box>
    </BoxFrame>
  )
}

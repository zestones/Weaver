import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { NoteForm } from '../forms/note-form.ts'
import type { UiModel } from '../model/ui-model.ts'
import { Keycap } from '../parts/keycap.tsx'
import { Pill } from '../parts/pill.tsx'
import { CONCLUDED } from '../theme/marks.ts'
import { THEME } from '../theme/theme.ts'
import { BoxFrame } from './box-frame.tsx'

const WIDTH = 72
const TEXT_LINES = 5

interface Props {
  readonly model: UiModel
  readonly form: NoteForm
}

// Writing on a card: the last note it holds, what the new one concludes, and its text.
export function NoteBox({ model, form }: Props): ReactNode {
  const last = form.card.record.notes.at(-1)
  const typed = form.text.text.split('\n').slice(-TEXT_LINES)
  const [first = ''] = (last?.text ?? '').split('\n')

  return (
    <BoxFrame title='Note' card={form.card} width={WIDTH} problem={form.problem}>
      {last === undefined ? null : (
        <Box flexDirection='column' paddingX={1} marginBottom={1} backgroundColor={THEME.ground}>
          <Box gap={1} height={1}>
            <Text bold color={THEME.ivory}>
              {last.provenance.role === 'owner' ? 'the owner' : last.provenance.author}
            </Text>
            {last.conclusion === null ? null : (
              <Pill tone={CONCLUDED[last.conclusion].tone}>{`${CONCLUDED[last.conclusion].mark} ${last.conclusion}`}</Pill>
            )}
            <Box flexGrow={1} />
            <Text color={THEME.muted}>{`${model.agoOf(last.provenance.at)} ago`}</Text>
          </Box>
          <Text color={THEME.muted} wrap='truncate-end'>
            {first}
          </Text>
        </Box>
      )}
      <Box gap={1} height={1}>
        <Box marginRight={1}>
          <Text color={THEME.muted}>CONCLUDES</Text>
        </Box>
        {NoteForm.CONCLUSIONS.map((conclusion) => {
          const name = conclusion ?? 'nothing'

          return conclusion === form.conclusion ? (
            <Text key={name} bold color={THEME.ground} backgroundColor={THEME.gold}>{` ${name} `}</Text>
          ) : (
            <Text key={name} color={THEME.muted}>{` ${name} `}</Text>
          )
        })}
      </Box>
      <Box flexDirection='column' height={TEXT_LINES} marginTop={1} paddingX={1} backgroundColor={THEME.ground} overflow='hidden'>
        {typed.map((line, index) => (
          <Box key={index} height={1}>
            <Text color={THEME.ivory} wrap='truncate-start'>
              {line}
            </Text>
            {index === typed.length - 1 ? <Text color={THEME.gold}>█</Text> : null}
          </Box>
        ))}
      </Box>
      <Box height={1} />
      <Box gap={3}>
        <Keycap cap='ctrl s'>Write</Keycap>
        <Keycap cap='tab'>Concludes</Keycap>
        <Keycap cap='ctrl e'>Your editor</Keycap>
      </Box>
      {model.said === null ? null : <Text color={THEME.muted}>{model.said.text}</Text>}
    </BoxFrame>
  )
}

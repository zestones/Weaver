import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import { useReducer, type ReactNode } from 'react'
import { KeyBar } from '../bars/key-bar.tsx'
import { TopBar } from '../bars/top-bar.tsx'
import { CloseBox } from '../boxes/close-box.tsx'
import { FilterBox } from '../boxes/filter-box.tsx'
import { HelpBox } from '../boxes/help-box.tsx'
import { LabelsBox } from '../boxes/labels-box.tsx'
import { NoteBox } from '../boxes/note-box.tsx'
import type { OwnEditor } from '../editor/own-editor.ts'
import { CloseForm } from '../forms/close-form.ts'
import { FilterForm } from '../forms/filter-form.ts'
import { HelpForm } from '../forms/help-form.ts'
import { LabelsForm } from '../forms/labels-form.ts'
import { NoteForm } from '../forms/note-form.ts'
import type { UiModel } from '../model/ui-model.ts'
import { CardDetail } from '../panes/card-detail.tsx'
import { CardList } from '../panes/card-list.tsx'
import { THEME } from '../theme/theme.ts'

// Under this size the panes have no room for a card.
const NARROWEST = 90
const LOWEST = 22

interface Props {
  readonly model: UiModel
  readonly editor: OwnEditor
  // The size to draw at; left out, the size of the terminal, followed as it changes.
  readonly size?: { readonly columns: number; readonly rows: number }
}

// The box in front of the panes, when one is open.
function OpenBox({ model }: { readonly model: UiModel }): ReactNode {
  const box = model.box

  if (box instanceof CloseForm) return <CloseBox model={model} form={box} />
  if (box instanceof LabelsForm) return <LabelsBox model={model} form={box} />
  if (box instanceof NoteForm) return <NoteBox model={model} form={box} />
  if (box instanceof FilterForm) return <FilterBox model={model} form={box} />

  return box instanceof HelpForm ? <HelpBox /> : null
}

// The whole screen: the bar, the two panes, the keys, and a box in front of them when one is open. It draws what
// the model holds and hands it every key; nothing about the cards is decided here.
export function App({ model, editor, size }: Props): ReactNode {
  const [, redraw] = useReducer((drawn: number) => drawn + 1, 0)
  const { exit, suspendTerminal } = useApp()
  const terminal = useWindowSize()
  const { columns, rows } = size ?? terminal

  model.resized(columns, rows)

  useInput((input, key) => {
    model.press(input, key)

    if (model.finished) exit()
    // The editor takes the terminal: the interface gives it up, and draws itself again when the editor is left.
    else if (model.box instanceof NoteForm && model.box.editing) {
      const typed = model.box.text.text

      suspendTerminal(() => {
        try {
          model.edited(editor.edit(typed))
        } catch (error) {
          model.edited(typed)
          model.said = { text: error instanceof Error ? error.message : String(error), problem: true }
        }
      }).then(redraw, redraw)
    }

    redraw()
  })

  if (columns < NARROWEST || rows < LOWEST) {
    return (
      <Box width={columns} height={rows} paddingX={1} backgroundColor={THEME.ground}>
        <Text color={THEME.muted} wrap='wrap'>
          {`This window is ${String(columns)} columns by ${String(rows)} rows: the cards need ${String(NARROWEST)} by ${String(LOWEST)} at least. Make it larger, or press q to leave.`}
        </Text>
      </Box>
    )
  }

  return (
    <Box
      flexDirection='column'
      width={columns}
      height={rows}
      paddingX={model.room.margin.across}
      paddingTop={model.room.margin.above}
      backgroundColor={THEME.ground}
    >
      <TopBar model={model} />
      <Box height={1} />
      <Box gap={model.room.between} height={model.paneHeight}>
        <CardList model={model} />
        <CardDetail model={model} />
      </Box>
      <Box height={1} />
      <KeyBar model={model} />
      {model.box === null ? null : (
        <Box position='absolute' width={columns} height={rows} alignItems='center' justifyContent='center'>
          <OpenBox model={model} />
        </Box>
      )}
    </Box>
  )
}

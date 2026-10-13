import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { FilterForm } from '../forms/filter-form.ts'
import { UiModel, type View } from '../model/ui-model.ts'
import { THEME } from '../theme/theme.ts'

const VIEW_NAMES: Readonly<Record<View, string>> = { open: 'Open', answered: 'Answered', closed: 'Closed', all: 'All' }
const BRAND = 'W E A V E R'
const GAP = 3
const SEARCH_WIDTH = 32
const SEARCH_NARROW = 22
const WIDE = 120
const NOTHING = '▾'

interface Props {
  readonly model: UiModel
}

// The line above the panes: whose cards these are, the views, what the list is narrowed to, and the search. What the
// list is narrowed to is said family by family where there is room, and in a word where there is not.
export function TopBar({ model }: Props): ReactNode {
  const views = UiModel.VIEWS.map((view) => ({ view, name: VIEW_NAMES[view], count: String(model.countOf(view)) }))
  const narrowed = [
    ...model.families.map((family) => ({
      name: `${family.charAt(0).toUpperCase()}${family.slice(1)}`,
      said: (model.labels[family] ?? []).join(', '),
    })),
    { name: 'Since', said: model.since === 'ever' ? '' : FilterForm.SINCE_NAMES[model.since] },
  ]
  const on = narrowed.filter(({ said }) => said !== '').length
  const search = model.columns >= WIDE ? SEARCH_WIDTH : SEARCH_NARROW
  const taken =
    BRAND.length +
    ' / '.length +
    model.project.length +
    views.reduce((sum, { name, count }) => sum + name.length + count.length + 3, 0) +
    search
  const room = model.columns - model.room.margin.across * 2 - 2 - taken - GAP * 3
  const whole =
    narrowed.reduce((sum, { name, said }) => sum + name.length + 1 + (said === '' ? NOTHING : said).length, 0) + (narrowed.length - 1) * 2
  const short = on === 0 ? `Filter ${NOTHING}` : `Filter ${String(on)} on`
  const searched = model.words.text

  return (
    <Box paddingX={1} gap={GAP} height={1}>
      <Box flexShrink={0} gap={1}>
        <Text bold color={THEME.ivory}>
          {BRAND}
        </Text>
        <Text color={THEME.gold}>/</Text>
        <Text color={THEME.muted}>{model.project}</Text>
      </Box>
      <Box flexShrink={0}>
        {views.map(({ view, name, count }) =>
          view === model.view ? (
            <Text key={view} bold color={THEME.ground} backgroundColor={THEME.gold}>
              {` ${name} ${count} `}
            </Text>
          ) : (
            <Box key={view} flexShrink={0} paddingX={1} gap={1}>
              <Text color={THEME.soft}>{name}</Text>
              <Text color={THEME.muted}>{count}</Text>
            </Box>
          ),
        )}
      </Box>
      <Box flexGrow={1} />
      {whole <= room ? (
        <Box flexShrink={0} gap={2}>
          {narrowed.map(({ name, said }) => (
            <Box key={name} flexShrink={0} gap={1}>
              <Text color={THEME.muted}>{name}</Text>
              <Text color={said === '' ? THEME.muted : THEME.ivory}>{said === '' ? NOTHING : said}</Text>
            </Box>
          ))}
        </Box>
      ) : short.length <= room ? (
        <Box flexShrink={0}>
          <Text color={on === 0 ? THEME.muted : THEME.ivory}>{short}</Text>
        </Box>
      ) : null}
      <Box flexShrink={0} width={search} height={1} paddingLeft={1} gap={1} backgroundColor={THEME.panel}>
        <Box flexGrow={1} flexShrink={1} height={1} overflow='hidden'>
          {searched === '' && !model.searching ? <Text color={THEME.muted}>Search</Text> : <Text color={THEME.ivory}>{searched}</Text>}
          {model.searching ? <Text color={THEME.gold}>█</Text> : null}
        </Box>
        <Box flexShrink={0}>
          <Text color={THEME.ivory} backgroundColor={THEME.chip}>
            {' / '}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

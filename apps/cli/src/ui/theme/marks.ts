import type { Conclusion } from '@weaver/memory'
import { THEME } from './theme.ts'

// The tone of a pill: one of the grounds of the theme with its ink, or a chip that says nothing by its colour.
export type Tone = 'coral' | 'orange' | 'green' | 'blue' | 'neutral' | 'quiet'

// The ink and the ground of each tone.
export const TONES: Readonly<Record<Tone, { readonly ink: string; readonly ground: string }>> = {
  coral: THEME.coral,
  orange: THEME.orange,
  green: THEME.green,
  blue: THEME.blue,
  neutral: { ink: THEME.soft, ground: THEME.chip },
  quiet: { ink: THEME.muted, ground: THEME.raised },
}

// What someone concluded of a card, as a mark that is read without colour and the tone that goes with it.
export const CONCLUDED: Readonly<Record<Conclusion, { readonly mark: string; readonly tone: Tone }>> = {
  confirmed: { mark: '✓', tone: 'green' },
  refuted: { mark: '✗', tone: 'coral' },
  unsure: { mark: '?', tone: 'neutral' },
  fixed: { mark: '●', tone: 'blue' },
}

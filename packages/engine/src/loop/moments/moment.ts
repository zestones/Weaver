import type { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'

export interface Moment {
  readonly speaksToOwner: boolean

  run(turn: Turn): Answer | Promise<Answer>
}

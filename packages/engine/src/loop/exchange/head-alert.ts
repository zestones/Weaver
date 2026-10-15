import type { Touch } from '../../unit-of-work/attribution/touch.ts'

export class HeadAlert {
  readonly text: string | null

  constructor(touches: readonly Touch[]) {
    const moved = touches.find((touch) => touch.headMoved !== null)

    this.text =
      moved === undefined
        ? null
        : `[weaver] HEAD moved while the ${moved.tool} call ran, by the call or by the owner meanwhile. Commits are the owner's: one the call made settles nothing, and the files of this unit of work are still checked as the agent's.`
  }
}

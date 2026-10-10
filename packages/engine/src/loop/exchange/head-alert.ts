import type { Touch } from '../../unit-of-work/attribution/touch.ts'

export class HeadAlert {
  readonly text: string | null

  constructor(touches: readonly Touch[]) {
    const moved = touches.find((touch) => touch.headMoved !== null)

    this.text =
      moved === undefined
        ? null
        : `[weaver] The ${moved.tool} call moved HEAD. Commits are the owner's: the files of this unit of work are still checked as the agent's.`
  }
}

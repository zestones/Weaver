import type { Caller } from '../../caller/caller.ts'
import { CardActor } from '../../caller/card-actor.ts'
import { CardDesk } from '../../cards/card-desk.ts'
import { Confirmation } from '../../input/confirmation.ts'
import { Counted } from '../../output/counted.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'

export class CloseProposals {
  private readonly cwd: string
  private readonly output: Output
  private readonly caller: Caller

  constructor(cwd: string, output: Output, caller: Caller) {
    this.cwd = cwd
    this.output = output
    this.caller = caller
  }

  run(args: readonly string[]): number {
    const screen = new Screen(this.output)
    if (args.filter((arg) => arg === '--proposed').length !== 1 || args.some((arg) => arg !== '--proposed' && arg !== '--yes')) {
      screen.misuse('close', 'close --proposed [--yes]')
      return 2
    }
    const project = Project.locate(this.cwd)
    const registry = project.registry(new CardActor(this.caller).provenance())
    try {
      const proposals = registry
        .list()
        .flatMap((card) => (card.isWaiting && card.record.proposal !== null ? [{ card, proposal: card.record.proposal }] : []))
      if (proposals.length === 0) {
        screen.line('No closing proposals wait for you.')
        return 0
      }
      screen.heading(`${new Counted(proposals.length, 'closing proposal').text} to accept`)
      for (const { card, proposal } of proposals) {
        screen.note(`#${String(card.number)} ${card.title} — ${proposal.as}`)
        const why = proposal.as === 'fixed' || proposal.cause === 'cause not recorded' ? proposal.fix : proposal.cause
        screen.hint(why.replaceAll(/\s+/g, ' ').trim(), 1)
        registry.showProposal(card.number, proposal)
      }
      if (!args.includes('--yes')) {
        const confirmation = new Confirmation()
        if (this.output.width === null || !confirmation.available) {
          screen.error('Bulk closing needs a terminal confirmation; pass --yes to accept these proposals without a terminal.')
          return 1
        }
        screen.hint(`Accept ${new Counted(proposals.length, 'closing proposal').text}? [y/N]`)
        if (!confirmation.ask()) {
          screen.note('No cards closed.')
          return 0
        }
      }
      new CardDesk(project, registry).closeProposed(proposals.map(({ card, proposal }) => ({ number: card.number, proposal })))
      screen.done(`${new Counted(proposals.length, 'card').text} closed.`)
      return 0
    } finally {
      registry.close()
    }
  }
}

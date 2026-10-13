import type { Form } from './form.ts'

// The keys of the interface, shown until any key is pressed.
export class HelpForm implements Form {
  readonly outcome: Form['outcome']
  readonly problem = null

  constructor(outcome: Form['outcome'] = 'open') {
    this.outcome = outcome
  }

  pressed(): HelpForm {
    return new HelpForm('cancelled')
  }

  refused(): HelpForm {
    return this
  }
}

import { render } from 'ink'
import type { CardDesk } from '../../cards/card-desk.ts'
import { Paint } from '../../output/paint.ts'
import { App } from '../app/app.tsx'
import { OwnEditor } from '../editor/own-editor.ts'
import { UiModel } from '../model/ui-model.ts'
import { ThemePaint } from '../theme/theme-paint.ts'
import { THEME } from '../theme/theme.ts'

const FULL_COLOUR: ReadonlySet<string> = new Set(['truecolor', '24bit'])
const ESCAPE = '\u001B'
// What asks a terminal to take a colour as its own ground, and to take back the one it had. The colour is asked for
// twice: as every terminal reads it, then with the opacity some of them read too, foot and rxvt among them, so that
// a terminal set to let its ground show through draws this one whole. A terminal skips the form it does not know.
const OWN_GROUND = `${ESCAPE}]11;${THEME.ground}${ESCAPE}\\${ESCAPE}]11;[100]${THEME.ground}${ESCAPE}\\`
const GROUND_BACK = `${ESCAPE}]111${ESCAPE}\\`

// The interface, from the moment it takes the screen to the moment the owner leaves it. It draws on a screen of its
// own, as an editor does: what the terminal showed before is there again afterwards.
export class Interface {
  private readonly desk: CardDesk
  private readonly project: string
  private readonly env: NodeJS.ProcessEnv
  private readonly terminal: NodeJS.WriteStream

  // `project` is the name shown beside Weaver's.
  constructor(desk: CardDesk, project: string, env: NodeJS.ProcessEnv = process.env, terminal: NodeJS.WriteStream = process.stdout) {
    this.desk = desk
    this.project = project
    this.env = env
    this.terminal = terminal
  }

  async run(): Promise<void> {
    // A terminal that says it draws sixteen million colours is given the theme as it is. Another one is given the
    // eight every terminal knows for what a card says, and the nearest it has for the rest.
    const paint = FULL_COLOUR.has(this.env.COLORTERM ?? '') ? new ThemePaint() : new Paint(true)
    const model = new UiModel(this.desk, this.project, paint)

    // A terminal keeps a margin around what a program draws, in its own ground, which no program can draw on. For
    // as long as the interface is open the terminal is asked to take the ground of the interface as its own, so
    // that the screen goes to the edge of the window; it is given its own back when the owner leaves.
    this.terminal.write(OWN_GROUND)

    try {
      await render(<App model={model} editor={new OwnEditor(this.env)} />, { stdout: this.terminal, alternateScreen: true }).waitUntilExit()
    } finally {
      this.terminal.write(GROUND_BACK)
    }
  }
}

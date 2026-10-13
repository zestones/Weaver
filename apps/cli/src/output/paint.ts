// What tells a stream that draws from one that is only read.
interface Stream {
  readonly isTTY?: boolean
}

const ESCAPE = '\u001B['

// The styles a line may carry. Off, each gives the text back as it is: what a program reads or a file keeps holds no
// escape code. Only the eight colours every terminal knows are used, and never to carry a meaning alone.
export class Paint {
  private readonly on: boolean

  constructor(on: boolean) {
    this.on = on
  }

  // Colour is for a person at a terminal: not for a pipe, not when NO_COLOR is set, not for a terminal that draws none,
  // and not when the owner asked for none.
  static for(stream: Stream, env: NodeJS.ProcessEnv, refused: boolean): Paint {
    return new Paint(stream.isTTY === true && !refused && (env.NO_COLOR ?? '') === '' && env.TERM !== 'dumb')
  }

  // Whether anything is drawn at all: off, a document is given as it is written.
  get enabled(): boolean {
    return this.on
  }

  bold(text: string): string {
    return this.styled(1, 22, text)
  }

  italic(text: string): string {
    return this.styled(3, 23, text)
  }

  // Grey, for what comes second: a hint, a path, a heading of a table.
  dim(text: string): string {
    return this.styled(90, 39, text)
  }

  green(text: string): string {
    return this.styled(32, 39, text)
  }

  red(text: string): string {
    return this.styled(31, 39, text)
  }

  yellow(text: string): string {
    return this.styled(33, 39, text)
  }

  blue(text: string): string {
    return this.styled(34, 39, text)
  }

  magenta(text: string): string {
    return this.styled(35, 39, text)
  }

  cyan(text: string): string {
    return this.styled(36, 39, text)
  }

  // A word of code inside a sentence.
  code(text: string): string {
    return this.cyan(text)
  }

  // Whether code is set on a ground of its own. The eight colours give none that suits every terminal: code stands
  // behind a bar instead.
  get grounds(): boolean {
    return false
  }

  // A line of code on its ground, when there is one.
  inset(text: string): string {
    return text
  }

  // The line of code that matters, on a ground lighter than the others.
  raised(text: string): string {
    return text
  }

  private styled(open: number, close: number, text: string): string {
    return this.on && text !== '' ? `${ESCAPE}${String(open)}m${text}${ESCAPE}${String(close)}m` : text
  }
}

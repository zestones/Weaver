export interface Input {
  // Everything the command is given to read, until its end.
  read(): string
}

export class DeclarationError extends Error {
  readonly problems: readonly string[]

  constructor(path: string, problems: readonly string[]) {
    super(`${path} is not a valid project declaration: ${problems.join('; ')}`)
    this.name = 'DeclarationError'
    this.problems = problems
  }
}

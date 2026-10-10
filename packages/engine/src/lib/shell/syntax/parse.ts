import { isAbsolute, join, normalize } from 'node:path'
import { parse, type Command, type Node, type Redirect, type Script, type Statement, type TestExpression } from 'unbash'
import { commandOf, EMPTY_BASE, type Assignment, type ShellCommand, type ShellRedirect } from './command.ts'
import { literalWord, shellWord, type ShellWord } from './words.ts'
import { peel } from './wrappers.ts'

export interface ShellAnalysis {
  readonly commands: readonly ShellCommand[]
  // False when the parser gave up on part of the text, or scripts nest deeper than it follows.
  readonly complete: boolean
}

type Cwd = string | null

const MAX_DEPTH = 6
const MAX_WRAPPERS = 10
const HEREDOC = new Set(['<<', '<<-'])
const NO_FILE = new Set(['<<<', '<&'])
// `>&word` duplicates a descriptor when the word is a number or `-`, and otherwise writes the file, as `&>` does.
const DESCRIPTOR = /^(\d+-?|-)$/

function redirectOf(redirect: Redirect): ShellRedirect {
  const { operator } = redirect

  if (HEREDOC.has(operator)) return { operator, target: null, heredoc: redirect.content ?? '' }
  if (NO_FILE.has(operator) || redirect.target === undefined) return { operator, target: null, heredoc: null }

  const target = shellWord(redirect.target)

  if (operator !== '>&') return { operator, target, heredoc: null }

  return DESCRIPTOR.test(target.text) ? { operator, target: null, heredoc: null } : { operator: '&>', target, heredoc: null }
}

function assignmentsOf(command: Command): Assignment[] {
  return command.prefix.flatMap((prefix) =>
    prefix.name === undefined ? [] : [{ name: prefix.name, value: prefix.value === undefined ? literalWord('') : shellWord(prefix.value) }],
  )
}

function nextCwd(command: ShellCommand, cwd: Cwd): Cwd {
  if (command.program !== 'cd' && command.program !== 'pushd') return cwd

  const target = command.words.find((word) => word.value?.startsWith('-') !== true)

  if (target?.value === undefined || target.value === null || cwd === null) return null

  return isAbsolute(target.value) ? normalize(target.value) : join(cwd, target.value)
}

// A branch or a loop body may or may not run: after it, the directory is known only if none of them changed it.
const settled = (cwd: Cwd, after: readonly Cwd[]): Cwd => (after.every((each) => each === cwd) ? cwd : null)

function testWords(expression: TestExpression): ShellWord[] {
  switch (expression.type) {
    case 'TestUnary':
      return [shellWord(expression.operand)]
    case 'TestBinary':
      return [shellWord(expression.left), shellWord(expression.right)]
    case 'TestLogical':
      return [...testWords(expression.left), ...testWords(expression.right)]
    case 'TestNot':
      return testWords(expression.operand)
    case 'TestGroup':
      return testWords(expression.expression)
  }
}

class Visitor {
  readonly commands: ShellCommand[] = []
  complete = true

  script(text: string, cwd: Cwd, depth: number): void {
    const script = parse(text)

    if (script.errors !== undefined && script.errors.length > 0) this.complete = false

    this.parsed(script, cwd, depth)
  }

  parsed(script: Script, cwd: Cwd, depth: number): void {
    if (depth > MAX_DEPTH) this.complete = false
    else this.list(script.commands, cwd, depth)
  }

  private list(statements: readonly Statement[], cwd: Cwd, depth: number): Cwd {
    return statements.reduce<Cwd>((current, statement) => this.statement(statement, current, depth), cwd)
  }

  private statement(statement: Statement, cwd: Cwd, depth: number): Cwd {
    const after = this.node(statement.command, cwd, depth)

    if (statement.redirects.length > 0) {
      this.emit(commandOf([], { ...EMPTY_BASE, cwd, redirects: statement.redirects.map(redirectOf) }), depth)
    }

    return after
  }

  private words(words: readonly ShellWord[], cwd: Cwd, depth: number): void {
    for (const script of words.flatMap((word) => word.scripts)) this.parsed(script, cwd, depth + 1)
  }

  private node(node: Node, cwd: Cwd, depth: number): Cwd {
    switch (node.type) {
      case 'Command':
        return this.simple(node, cwd, depth)
      case 'Statement':
        return this.statement(node, cwd, depth)
      case 'CompoundList':
      case 'BraceGroup':
        return this.list(node.type === 'BraceGroup' ? node.body.commands : node.commands, cwd, depth)
      case 'AndOr':
        return node.commands.reduce<Cwd>((current, member) => this.node(member, current, depth), cwd)
      case 'Pipeline':
        this.pipeline(node.commands, cwd, depth)

        return cwd
      default:
        return this.compound(node, cwd, depth)
    }
  }

  // Each member of a pipeline runs in a subshell, and reads what the members before it wrote.
  private pipeline(members: readonly Node[], cwd: Cwd, depth: number): void {
    const upstream: ShellCommand[] = []

    for (const member of members) {
      const start = this.commands.length

      this.node(member, cwd, depth)

      const produced = this.commands.slice(start).map((command) => ({ ...command, upstream: [...upstream] }))

      this.commands.splice(start, produced.length, ...produced)
      upstream.push(...produced)
    }
  }

  private compound(node: Exclude<Node, Command | Statement>, cwd: Cwd, depth: number): Cwd {
    switch (node.type) {
      case 'If':
        return settled(cwd, [
          this.list(node.clause.commands, cwd, depth),
          this.list(node.then.commands, cwd, depth),
          node.else === undefined ? cwd : this.node(node.else, cwd, depth),
        ])
      case 'For':
      case 'Select':
        this.words(node.wordlist.map(shellWord), cwd, depth)

        return settled(cwd, [this.list(node.body.commands, cwd, depth)])
      case 'While':
        return settled(cwd, [this.list(node.clause.commands, cwd, depth), this.list(node.body.commands, cwd, depth)])
      case 'ArithmeticFor':
        return settled(cwd, [this.list(node.body.commands, cwd, depth)])
      case 'Case':
        this.words([shellWord(node.word)], cwd, depth)

        return settled(
          cwd,
          node.items.map((item) => this.list(item.body.commands, cwd, depth)),
        )
      case 'Subshell':
        this.list(node.body.commands, cwd, depth)

        return cwd
      case 'Function':
      case 'Coproc':
        this.node(node.body, cwd, depth)

        return cwd
      case 'TestCommand':
        this.words(testWords(node.expression), cwd, depth)

        return cwd
      default:
        return cwd
    }
  }

  private simple(node: Command, cwd: Cwd, depth: number): Cwd {
    const argv = [...(node.name === undefined ? [] : [node.name]), ...node.suffix].map(shellWord)
    const assigns = assignmentsOf(node)
    const redirects = node.redirects.map(redirectOf)
    const command = commandOf(argv, { ...EMPTY_BASE, assigns, redirects, cwd })

    this.words(
      [
        ...argv,
        ...assigns.map((assign) => assign.value),
        ...redirects.flatMap((redirect) => (redirect.target === null ? [] : [redirect.target])),
      ],
      cwd,
      depth,
    )
    this.emit(command, depth)

    return nextCwd(command, cwd)
  }

  private emit(command: ShellCommand, depth: number): void {
    let current = command

    for (let layer = 0; layer < MAX_WRAPPERS; layer += 1) {
      const peeled = peel(current)

      this.commands.push(current)

      if (peeled === null) return
      if ('script' in peeled) {
        this.script(peeled.script, current.cwd, depth + 1)

        return
      }

      current = peeled.command
    }

    this.complete = false
  }
}

export function analyzeShell(text: string, cwd: string | null): ShellAnalysis {
  const visitor = new Visitor()

  visitor.script(text, cwd, 0)

  return { commands: visitor.commands, complete: visitor.complete }
}

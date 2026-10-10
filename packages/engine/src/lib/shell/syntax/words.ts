import { parse, type DoubleQuotedChild, type Script, type Word, type WordPart } from 'unbash'

export interface ShellWord {
  readonly text: string
  // What the shell passes on, or null when an expansion decides it at run time.
  readonly value: string | null
  readonly variables: readonly string[]
  readonly scripts: readonly Script[]
}

interface Collected {
  readonly variables: string[]
  readonly scripts: Script[]
}

const scriptOf = (script: Script | undefined, inner: string | undefined): Script[] => {
  if (script !== undefined) return [script]

  return inner === undefined ? [] : [parse(inner)]
}

function partValue(part: WordPart | DoubleQuotedChild, into: Collected): string | null {
  switch (part.type) {
    case 'Literal':
    case 'SingleQuoted':
    case 'AnsiCQuoted':
      return part.value
    case 'DoubleQuoted':
    case 'LocaleString':
      return joined(part.parts.map((child) => partValue(child, into)))
    case 'SimpleExpansion':
      into.variables.push(part.text.replace(/^\$/, ''))

      return null
    case 'ParameterExpansion':
      into.variables.push(part.parameter)

      return null
    case 'CommandExpansion':
    case 'ProcessSubstitution':
      into.scripts.push(...scriptOf(part.script, part.inner))

      return null
    default:
      return null
  }
}

const joined = (values: readonly (string | null)[]): string | null => (values.includes(null) ? null : values.join(''))

// A leading `~` is the user's home, outside what the policy can place.
const placeable = (value: string | null): string | null => (value?.startsWith('~') === true ? null : value)

export function shellWord(word: Word): ShellWord {
  const into: Collected = { variables: [], scripts: [] }
  const value = word.parts === undefined ? word.value : joined(word.parts.map((part) => partValue(part, into)))

  return { text: word.text, value: placeable(value), ...into }
}

export const literalWord = (value: string): ShellWord => ({ text: value, value, variables: [], scripts: [] })

export const argText = (word: ShellWord): string => word.value ?? word.text

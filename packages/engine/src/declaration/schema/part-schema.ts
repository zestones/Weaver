import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import checks from './checks.schema.json' with { type: 'json' }
import type { PartName } from './declaration-document.ts'
import guards from './guards.schema.json' with { type: 'json' }
import reviewers from './reviewers.schema.json' with { type: 'json' }
import rules from './rules.schema.json' with { type: 'json' }
import scripts from './scripts.schema.json' with { type: 'json' }
import settings from './settings.schema.json' with { type: 'json' }

const SCHEMAS: Readonly<Record<PartName, object>> = { settings, guards, checks, scripts, reviewers, rules }
const TYPES: Readonly<Record<string, string>> = { object: 'an object', array: 'a list', string: 'a text', integer: 'a whole number' }

// The shape of one file of `.weaver/`: its schema is the single definition of what the file may hold.
export class PartSchema {
  private readonly validate: ValidateFunction

  constructor(part: PartName) {
    this.validate = new Ajv({ allErrors: true, useDefaults: true, allowUnionTypes: true }).compile(SCHEMAS[part])
  }

  // An accepted value comes out with an empty list or map where it left one out.
  accepts(value: unknown): boolean {
    return this.validate(value)
  }

  get problems(): string[] {
    // A refused key is reported twice: once for its pattern, once as a key.
    return (this.validate.errors ?? []).filter((error) => error.propertyName === undefined).map((error) => this.problem(error))
  }

  private kinds(type: unknown): string {
    return (Array.isArray(type) ? type : [type]).map((kind) => TYPES[String(kind)] ?? String(kind)).join(' or ')
  }

  private problem(error: ErrorObject): string {
    const at = error.instancePath.slice(1).replaceAll('/', '.')
    const inside = (key: unknown): string => (at === '' ? String(key) : `${at}.${String(key)}`)
    const params = error.params as Record<string, unknown>

    switch (error.keyword) {
      case 'additionalProperties':
        return `${inside(params.additionalProperty)} is not a known field`
      case 'required':
        return `${inside(params.missingProperty)} is missing`
      case 'propertyNames':
        return `${inside(params.propertyName)} is not a valid name`
      case 'enum':
        return `${at} must be one of ${(params.allowedValues as unknown[]).join(', ')}`
      case 'const':
        return `${at} must be ${String(params.allowedValue)}`
      case 'type':
        return `${at === '' ? 'the file' : at} must be ${this.kinds(params.type)}`
      case 'minItems':
      case 'minLength':
        return `${at} must not be empty`
      case 'minimum':
        return `${at} must be at least ${String(params.limit)}`
      default:
        return `${at} ${error.message ?? 'is not valid'}`
    }
  }
}

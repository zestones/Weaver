import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import type { DeclarationDocument } from './declaration-document.ts'
import schema from './weaver.config.schema.json' with { type: 'json' }

const TYPES: Readonly<Record<string, string>> = { object: 'an object', array: 'a list', string: 'a text', integer: 'a whole number' }

export class DeclarationSchema {
  private readonly validate: ValidateFunction<DeclarationDocument>

  constructor() {
    this.validate = new Ajv({ allErrors: true, useDefaults: true }).compile<DeclarationDocument>(schema)
  }

  // An accepted value comes out with the defaults it left out filled in.
  accepts(value: unknown): value is DeclarationDocument {
    return this.validate(value)
  }

  get problems(): string[] {
    // A refused key is reported twice: once for its pattern, once as a key.
    return (this.validate.errors ?? []).filter((error) => error.propertyName === undefined).map((error) => this.problem(error))
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
        return `${inside(params.propertyName)} is not a valid identifier`
      case 'enum':
        return `${at} must be one of ${(params.allowedValues as unknown[]).join(', ')}`
      case 'const':
        return `${at} must be ${String(params.allowedValue)}`
      case 'type':
        return `${at === '' ? 'the file' : at} must be ${TYPES[String(params.type)] ?? String(params.type)}`
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

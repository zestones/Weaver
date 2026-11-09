import type { SessionRecord } from './session-record.ts'

export class SessionMigration {
  read(value: unknown): SessionRecord | null {
    const record = value as Omit<SessionRecord, 'version'> & { readonly version: number }

    if (record.version === 10) return record as SessionRecord
    if (record.version !== 9) return null

    return {
      ...record,
      version: 10,
      unit: {
        ...record.unit,
        check: { ...record.unit.check, retry: false, judged: null, validation: [] },
      },
    }
  }
}

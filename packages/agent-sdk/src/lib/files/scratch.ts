import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A folder that lasts as long as what is done with it.
export async function withScratch<Result>(use: (dir: string) => Promise<Result>): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), 'weaver-agent-'))

  try {
    return await use(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

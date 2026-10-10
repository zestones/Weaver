import assert from 'node:assert/strict'
import { test } from 'vitest'
import { shellWrites } from '../../../src/lib/shell/writes/write-scope.ts'

const ROOT = '/repo'
const of = (line: string) => shellWrites(line, ROOT, ROOT)

test('a command that only reads writes nothing', () => {
  assert.equal(of('git status && npm test'), null)
})

test('a writer with literal targets writes those paths', () => {
  assert.deepEqual(of('cp a.ts src/b.ts && rm -rf src/old'), ['src/b.ts', 'src/old'])
})

test('inline code that writes, a formatter, a generator or a target an expansion decides may write anything', () => {
  for (const line of [
    "node -e \"require('fs').writeFileSync('x', '1')\"",
    'npx prettier --write src',
    'npm run generate',
    'echo x > "$OUT"',
    'git apply fix.patch',
    'npx vitest run -u',
    'npm test -- -u',
  ]) {
    assert.equal(of(line), 'all', line)
  }
})

test('anything else writes nothing that can be told from its words', () => {
  for (const line of ['node scripts/run.mjs', 'make dev-api', 'python3 script.py', 'python3 -c "print(\'hello\')"']) {
    assert.equal(of(line), 'none', line)
  }
})

test('formatters that write account for all their writes', () => {
  for (const command of ['ruff check src', 'python -m ruff format src', 'sqlfluff fix query.sql']) {
    assert.equal(of(command), 'all', command)
  }
})

test('a generator the project declares may write anything, and one it does not declare nothing that can be told', () => {
  const hints = { writers: ['npm run api:types', 'make contract', 'python -m openapi_document'], readers: [] }

  for (const command of [
    'npm run api:types',
    'make contract',
    'timeout 900 make -C platform contract',
    'cd api && python -m openapi_document',
  ]) {
    assert.equal(shellWrites(command, ROOT, ROOT, hints), 'all', command)
    assert.equal(of(command), 'none', command)
  }
})

test('a checker the project declares as a reader only reads', () => {
  const hints = { writers: [], readers: ['python -m tools.lint'] }

  assert.equal(shellWrites('python -m tools.lint --all', ROOT, ROOT, hints), null)
  assert.equal(of('python -m tools.lint --all'), 'none')
})

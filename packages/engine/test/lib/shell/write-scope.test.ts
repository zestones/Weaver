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

test('a script, an interpreter or a program whose words do not say what it writes may write anything', () => {
  for (const line of [
    'node scripts/run.mjs',
    'make dev-api',
    'python3 script.py',
    'python3 -c "print(\'hello\')"',
    'python3 - <<EOF\nimport runpy\nrunpy.run_path("extract.py")\nEOF',
    'python3 extract.py > extract.log',
    `perl -pi -e 's/a/b/' src/a.ts`,
    'git checkout -- src/a.ts',
  ]) {
    assert.equal(of(line), 'all', line)
  }
})

test('formatters that write account for all their writes', () => {
  for (const command of ['ruff check src', 'python -m ruff format src', 'sqlfluff fix query.sql']) {
    assert.equal(of(command), 'all', command)
  }
})

test('a generator the project declares may write anything, even one that reads by its name', () => {
  const hints = { writers: ['npm run build', 'make contract'], readers: [] }

  for (const command of ['npm run build', 'make contract', 'timeout 900 make -C platform contract']) {
    assert.equal(shellWrites(command, ROOT, ROOT, hints), 'all', command)
  }

  assert.equal(of('npm run build'), null)
})

test('a checker the project declares as a reader only reads', () => {
  const hints = { writers: [], readers: ['python -m tools.lint'] }

  assert.equal(shellWrites('python -m tools.lint --all', ROOT, ROOT, hints), null)
  assert.equal(of('python -m tools.lint --all'), 'all')
})

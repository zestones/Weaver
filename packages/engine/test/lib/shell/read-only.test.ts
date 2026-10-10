import assert from 'node:assert/strict'
import { test } from 'vitest'
import { readsOnly } from '../../../src/lib/shell/writes/read-only.ts'

const CWD = '/repo'

test('commands that can only read open no window', () => {
  for (const command of [
    'ls -la && cat a.ts | grep x',
    'git status',
    'git diff HEAD -- a.ts',
    'npm test',
    'npm run lint',
    'npx tsc --noEmit',
    'find . -name "*.ts"',
    'echo x > /dev/null',
    'npm test 2>&1 >&2',
    "yq '.x' ci.yml",
  ]) {
    assert.equal(readsOnly(command, CWD), true, command)
  }
})

test('anything that may write opens one', () => {
  for (const command of [
    'echo x > a.ts',
    'sed -i s/a/b/ a.ts',
    "sed -n 's/a/b/w out' a.ts",
    'env rm a.ts',
    'find . -delete',
    'sort -o a.ts a.ts',
    'sort -uo a.ts a.ts',
    'echo hi >& a.ts',
    "yq -i '.x = 1' ci.yml",
    'tree -o tree.txt',
    'git format-patch -1',
    'npm test -- -u',
    'npm run generate',
    'prettier --write .',
    'git commit -m x',
    'git diff --output=patch',
    'node -e "1"',
    'python3 script.py',
    'python -c "write_files()" -m ruff check --no-fix',
    'python script.py -m ruff check --no-fix',
  ]) {
    assert.equal(readsOnly(command, CWD), false, command)
  }
})

test('linters are read-only only when their write modes are excluded', () => {
  for (const command of [
    'ruff check --no-fix platform/api',
    'ruff format --check platform/api',
    'python -m ruff check --no-fix platform/api',
    'basedpyright --outputjson',
    'sqlfluff lint query.sql',
    'pytest tests/contract',
  ]) {
    assert.equal(readsOnly(command, CWD), true, command)
  }

  for (const command of [
    'ruff check platform/api',
    'ruff check --no-fix --fix platform/api',
    'ruff format platform/api',
    'sqlfluff fix query.sql',
    'pytest tests/contract --snapshot-update',
    'python -m openapi_document',
    'make contract',
  ]) {
    assert.equal(readsOnly(command, CWD), false, command)
  }
})

test('what the project declares about its own commands wins over what the engine guesses', () => {
  const hints = { generators: ['npm run lint'], readers: ['make verify'] }

  assert.equal(readsOnly('npm run lint', CWD, hints), false)
  assert.equal(readsOnly('make verify', CWD, hints), true)
  assert.equal(readsOnly('make verify > out.txt', CWD, hints), false)
  assert.equal(readsOnly('make clean verify', CWD, hints), false, 'a reader is named by the exact start of its command')
})

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { OwnEditor } from '../../src/ui/editor/own-editor.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-editor-'))
// Stands for an editor: it adds a line to the file it is given, and fails when asked to.
const editor = join(scratch, 'editor.sh')

writeFileSync(editor, '#!/bin/sh\nif [ "$1" = "--fail" ]; then exit 3; fi\nprintf "%s\\n" "added by ${2:-nobody}" >> "$1"\n')
chmodSync(editor, 0o755)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the editor of the owner is given the text in a file, and what it saved is the text', () => {
  assert.equal(new OwnEditor({ EDITOR: editor }).edit('Typed in the box.\n'), 'Typed in the box.\nadded by nobody\n')
  assert.equal(new OwnEditor({ VISUAL: editor, EDITOR: 'false' }).edit(''), 'added by nobody\n', 'VISUAL comes before EDITOR, as for git')
})

test('an editor named with its options is run with them, and one that fails leaves the note as it was', () => {
  assert.throws(
    () => new OwnEditor({ EDITOR: `${editor} --fail` }).edit('kept'),
    /editor\.sh --fail ended with the status 3: the note is as it was$/,
  )
})

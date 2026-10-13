import assert from 'node:assert/strict'
import { test } from 'vitest'
import { LabelFamilies } from '../../src/cards/label-families.ts'

test('the families a project declares are shown in one order: the level, the area and the type, then the others as declared', () => {
  assert.deepEqual(new LabelFamilies(['type', 'status', 'area', 'level']).ordered, ['level', 'area', 'type', 'status'])
  assert.deepEqual(new LabelFamilies(['size', 'area']).ordered, ['area', 'size'])
  assert.deepEqual(new LabelFamilies([]).ordered, [])
})

test('a card has one level and one type, and as many values as fit in any other family', () => {
  const families = new LabelFamilies(['type', 'area', 'level', 'status'])

  assert.deepEqual(
    ['level', 'type', 'area', 'status'].map((family) => families.takesOne(family)),
    [true, true, false, false],
  )
  assert.equal(new LabelFamilies(['area']).takesOne('level'), false, 'a family the project does not declare takes nothing')
})

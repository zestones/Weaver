import assert from 'node:assert/strict'
import { AgentResult, ExecutionCatalog, ScriptedExecution, type AgentExecution } from '@weaver/agent-sdk'
import { afterAll, test } from 'vitest'
import { CardRegistry } from '../../src/registry/card-registry.ts'
import type { LabelCatalog, WriterJob } from '../../src/writing/request/writer-job.ts'
import { WriterRun } from '../../src/writing/running/writer-run.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('writer-run')
const LABELS: LabelCatalog = {
  type: { bug: 'Something does not work as intended.', debt: 'Code that will cost later.' },
  area: { auth: 'Signing in and tokens.' },
}
const JOB: WriterJob = {
  top: registries.folder(),
  stateDir: registries.folder(),
  settings: {
    runtime: 'codex',
    model: 'gpt-5.5',
    effort: 'high',
    timeoutSeconds: 300,
    skill: null,
    sections: ['Observation', 'Uncertainties'],
  },
  labels: LABELS,
  environment: { WEAVER_WRITER: '1' },
}
const SECTIONS = [
  { name: 'Observation', text: 'Nothing calls `refresh()`.' },
  { name: 'Uncertainties', text: 'The application was not run.' },
]
const cardOf = (flag: number, fields: Readonly<Record<string, unknown>> = {}) => ({
  flag,
  title: `The card of flag ${String(flag)}`,
  labels: [{ family: 'type', value: 'bug' }],
  sections: SECTIONS,
  look: { verdict: 'agrees', note: 'Read the file: nothing calls it.' },
  sameAs: null,
  sure: false,
  sameNote: null,
  ...fields,
})
const answering = (...cards: readonly unknown[]) => new AgentResult({ text: '', answer: { cards }, seconds: 12, costUsd: 0.02 })
const failing = (failure: string) => new AgentResult({ text: '', seconds: 300, failure, failureKind: 'timeout' })
const agent = (...answers: readonly AgentResult[]) => new ScriptedExecution('codex', answers)
const run = (registry: CardRegistry, writer: AgentExecution, job: WriterJob = JOB) =>
  new WriterRun(job, new ExecutionCatalog([new ScriptedExecution('claude', []), writer]), registry).run()
const bodyOf = (word: string) => flagRecordOf(FLAG_BODY.replace('refresh()', word))
const stateOf = (registry: CardRegistry, number: number) => {
  const record = registry.find(number)?.record

  return [record?.state, record?.writing.attempts, record?.writing.failure]
}

// As many raw flags as asked, all on the same file.
function flagged(count: number): CardRegistry {
  const registry = registries.fresh()

  for (let number = 1; number <= count; number += 1) registry.flag(flagOf(bodyOf(`call${String(number)}()`)))

  return registry
}

afterAll(() => {
  registries.discard()
})

test('the writer is one task of the runtime the project names, started where the project is, to read only, in the environment the caller gave', async () => {
  const registry = flagged(1)
  const writer = agent(answering(cardOf(1)))

  await run(registry, writer)

  const [task] = writer.tasks

  assert.equal(writer.tasks.length, 1)
  assert.deepEqual(
    [task?.cwd, task?.access, task?.beforeTool, task?.model, task?.effort, task?.timeoutSeconds, task?.environment],
    [JOB.top, 'read-only', null, 'gpt-5.5', 'high', 300, { WEAVER_WRITER: '1' }],
  )
  assert.match(task?.prompt ?? '', /### Flag #1\n/)
  assert.match(JSON.stringify(task?.answerSchema), /"flag":\{"type":"integer","enum":\[1\]\}/)
})

test('a flag the writer wrote up is an open card: its title, its labels, its sections, what the writer saw, and what the task took', async () => {
  const registry = flagged(1)

  await run(registry, agent(answering(cardOf(1))))

  const card = registry.find(1)
  const written = card?.record.written

  assert.deepEqual([card?.state, card?.title, card?.labels()], ['open', 'The card of flag 1', ['type:bug']])
  assert.deepEqual(written?.sections, SECTIONS)
  assert.deepEqual(written?.look, { verdict: 'agrees', note: 'Read the file: nothing calls it.' })
  assert.deepEqual(written?.writer, { runtime: 'codex', model: 'gpt-5.5', seconds: 12, costUsd: 0.02 })
  assert.match(written?.at ?? '', /^\d{4}-\d\d-\d\dT/)
  assert.match(card?.record.flag?.text ?? '', /^Seen: no call of call1\(\)/, 'the flag is kept word for word')
  assert.deepEqual(registry.awaitingWriter(WriterRun.MAX_ATTEMPTS), [])
  assert.equal(registry.takeWriterTurn(process.ppid), true, 'the writer left its turn')
})

test('a label that is not in the catalogue of the project is dropped, and the others come in the order the project declares them', async () => {
  const registry = flagged(2)
  const labels = [
    { family: 'area', value: 'auth' },
    { family: 'type', value: 'security' },
    { family: 'priority', value: 'high' },
    { family: 'type', value: 'debt' },
    { family: 'type', value: 'bug' },
    { family: 'type', value: 'bug' },
    'type:bug',
  ]

  await run(registry, agent(answering(cardOf(1, { labels }), cardOf(2, { labels: [{ family: 'priority', value: 'high' }] }))))

  assert.deepEqual(registry.find(1)?.record.written?.labels, { type: ['bug', 'debt'], area: ['auth'] })
  assert.deepEqual(registry.find(2)?.record.written?.labels, {})
  assert.equal(registry.find(2)?.state, 'open')
})

test('a label whose value comes with its family in front, as the list shown to the writer writes it, is taken', async () => {
  const registry = flagged(1)

  await run(
    registry,
    agent(
      answering(
        cardOf(1, {
          labels: [
            { family: 'type', value: 'type:debt' },
            { family: 'area', value: 'type:bug' },
          ],
        }),
      ),
    ),
  )

  assert.deepEqual(registry.find(1)?.record.written?.labels, { type: ['debt'] })
})

test('a flag that is surely the same thing as a known card becomes an occurrence of it, and keeps what was written of it', async () => {
  const registry = flagged(2)

  registry.written(1, writtenOf())
  await run(registry, agent(answering(cardOf(2, { sameAs: 1, sure: true, sameNote: 'Both say that nothing refreshes the token.' }))))

  const [known, flag] = [registry.find(1), registry.find(2)]

  assert.deepEqual([flag?.state, flag?.record.mergedInto, flag?.title], ['merged', 1, 'The card of flag 2'])
  assert.deepEqual(
    known?.record.occurrences.map(({ card, note }) => [card, note]),
    [[2, 'Both say that nothing refreshes the token.']],
  )
  assert.deepEqual(
    registry.list().map((card) => card.number),
    [1],
  )
  assert.equal(registry.separate(2).state, 'open', 'taken apart, it is a card, and is not written up again')
})

test('a flag that may be the same thing as a known card is written, and tied to it', async () => {
  const registry = flagged(2)

  registry.written(1, writtenOf())
  registry.closeCard(1, 'wontfix', 'wanted')
  await run(registry, agent(answering(cardOf(2, { sameAs: 1, sure: false }))))

  assert.deepEqual([registry.find(2)?.state, registry.find(2)?.record.ties, registry.find(1)?.record.ties], ['open', [1], [2]])
  assert.deepEqual([registry.find(1)?.state, registry.find(1)?.record.seenSinceClosing], ['closed', false])
  assert.equal(registry.find(2)?.record.history.at(-1)?.note, 'to #1: the writer read them as the same thing')
})

test('a flag is joined only to a card the writer was shown: one that names its files, or a flag written up just before it', async () => {
  const registry = flagged(3)

  registry.open(findingOf())
  await run(
    registry,
    agent(answering(cardOf(1, { sameAs: 2, sure: true }), cardOf(2, { sameAs: 4, sure: true }), cardOf(3, { sameAs: 1, sure: true }))),
  )

  assert.deepEqual([registry.find(1)?.state, registry.find(2)?.state], ['open', 'open'], 'neither a later flag nor a card on other files')
  assert.deepEqual([registry.find(3)?.state, registry.find(3)?.record.mergedInto], ['merged', 1])
  assert.equal(registry.find(4)?.record.occurrences.length, 0)
})

test('a flag that is the same thing as one merged a moment ago goes where that one went', async () => {
  const registry = flagged(3)

  registry.written(1, writtenOf())
  await run(registry, agent(answering(cardOf(2, { sameAs: 1, sure: true }), cardOf(3, { sameAs: 2, sure: true }))))

  assert.deepEqual([registry.find(2)?.record.mergedInto, registry.find(3)?.record.mergedInto], [1, 1])
  assert.equal(registry.find(1)?.record.occurrences.length, 2)
})

test('an answer that misses a flag fails that flag only: it stays raw with the reason', async () => {
  const registry = flagged(3)

  await run(registry, agent(answering(cardOf(1), cardOf(3), cardOf(7))))

  assert.deepEqual(stateOf(registry, 1), ['open', 0, null])
  assert.deepEqual(stateOf(registry, 2), ['raw', 1, 'the answer of the writer has no card for this flag'])
  assert.deepEqual(stateOf(registry, 3), ['open', 0, null])
  assert.deepEqual(
    registry.find(2)?.record.history.map(({ action }) => action),
    ['flagged', 'writing-failed'],
  )
})

test('a card without its title, one of its sections or what the writer saw fails its flag only, and says what is missing', async () => {
  const registry = flagged(5)
  const [observation] = SECTIONS

  await run(
    registry,
    agent(
      answering(
        cardOf(1, { title: '   ' }),
        cardOf(2, { sections: [observation] }),
        cardOf(3, { sections: [{ name: 'Observation', text: '' }, 'Uncertainties'] }),
        cardOf(4, { look: { verdict: 'probably', note: 'Read it.' } }),
        cardOf(5, { title: ' A title\n  on two lines ', sections: [...SECTIONS, { name: 'Fix', text: 'Call it.' }] }),
      ),
    ),
  )

  assert.deepEqual(stateOf(registry, 1), ['raw', 1, 'the card of the writer has no title'])
  assert.deepEqual(stateOf(registry, 2), ['raw', 1, 'the card of the writer misses the section Uncertainties'])
  assert.deepEqual(stateOf(registry, 3), ['raw', 1, 'the card of the writer misses the sections Observation, Uncertainties'])
  assert.deepEqual(stateOf(registry, 4), ['raw', 1, 'the card of the writer does not say what it saw when it looked'])
  assert.deepEqual(
    [registry.find(5)?.state, registry.find(5)?.record.written?.sections],
    ['open', SECTIONS],
    'a section nobody asked for is left out',
  )
  assert.equal(registry.find(5)?.title, 'A title on two lines', 'a title is one line')
})

test('an answer that is not a list of cards fails every flag it was asked about', async () => {
  const registry = flagged(2)

  await run(registry, agent(new AgentResult({ text: 'Here are the cards.', answer: { summary: 'two cards' }, seconds: 3 })))

  assert.deepEqual(stateOf(registry, 1), ['raw', 1, 'the writer answered without a list of cards'])
  assert.deepEqual(stateOf(registry, 2), ['raw', 1, 'the writer answered without a list of cards'])
})

test('a task that fails as a whole fails all its flags the same way', async () => {
  const registry = flagged(2)
  const writer = agent(failing('no answer after 300 s'))

  await run(registry, writer)

  assert.equal(writer.tasks.length, 1, 'a flag is not asked twice in one run')
  assert.deepEqual(stateOf(registry, 1), ['raw', 1, 'no answer after 300 s'])
  assert.deepEqual(stateOf(registry, 2), ['raw', 1, 'no answer after 300 s'])
  assert.equal(registry.takeWriterTurn(process.ppid), true, 'the writer left its turn')
})

test('a flag that could not be written is tried once more by a later run, and no more after that', async () => {
  const registry = flagged(1)
  const writer = agent(failing('no answer after 300 s'), failing('codex exited with 1'), answering(cardOf(1)))

  await run(registry, writer)
  await run(registry, writer)

  assert.equal(writer.tasks.length, 2)
  assert.deepEqual(stateOf(registry, 1), ['raw', 2, 'codex exited with 1'])

  await run(registry, writer)

  assert.equal(writer.tasks.length, 2, 'two attempts, as MAX_ATTEMPTS says')
  assert.equal(WriterRun.MAX_ATTEMPTS, 2)
  assert.deepEqual(stateOf(registry, 1), ['raw', 2, 'codex exited with 1'])
  assert.equal(registry.list().length, 1, 'the flag is still listed, raw')
})

test('a flag that fails once is written up by the run that tries again', async () => {
  const registry = flagged(1)
  const writer = agent(failing('no answer after 300 s'), answering(cardOf(1)))

  await run(registry, writer)
  await run(registry, writer)

  assert.deepEqual(stateOf(registry, 1), ['open', 1, null])
})

test('a runtime Weaver cannot start, or an agent that breaks, fails the flags instead of losing them', async () => {
  const [unknown, broken] = [flagged(1), flagged(1)]
  const breaking: AgentExecution = { runtime: 'codex', isAvailable: () => true, run: () => Promise.reject(new Error('spawn ENOMEM')) }

  await new WriterRun(JOB, new ExecutionCatalog([new ScriptedExecution('claude', [])]), unknown).run()
  await run(broken, breaking)

  assert.deepEqual(stateOf(unknown, 1), ['raw', 1, 'Weaver cannot start codex'])
  assert.deepEqual(stateOf(broken, 1), ['raw', 1, 'the writer broke: spawn ENOMEM'])
})

test('nothing is asked when no flag waits, or while another writer holds the turn', async () => {
  const [empty, held] = [registries.fresh(), flagged(1)]
  const writer = agent(answering(cardOf(1)))

  empty.open(findingOf())
  held.takeWriterTurn(process.ppid)
  await run(empty, writer)
  await run(held, writer)

  assert.equal(writer.tasks.length, 0)
  assert.deepEqual(stateOf(held, 1), ['raw', 0, null])
  assert.equal(held.takeWriterTurn(process.pid), false, 'the turn stays with the one that holds it')
})

test('flags are written up a few at a time, and the ones made while the writer works before it leaves', async () => {
  const registry = flagged(7)
  const asked: number[][] = []
  const writer: AgentExecution = {
    runtime: 'codex',
    isAvailable: () => true,
    run: (task) => {
      const numbers = [...task.prompt.matchAll(/### Flag #(\d+)/g)].map(([, number]) => Number(number))

      if (asked.push(numbers) === 1) registry.flag(flagOf(bodyOf('late()')))

      return Promise.resolve(answering(...numbers.map((number) => cardOf(number))))
    },
  }

  await run(registry, writer)

  assert.deepEqual(asked, [
    [1, 2, 3, 4, 5],
    [6, 7, 8],
  ])
  assert.deepEqual(
    registry.list().map((card) => card.state),
    Array.from({ length: 8 }, () => 'open'),
  )
})

test('a run that is given no registry opens the one of the job, and closes it', async () => {
  const stateDir = registries.folder()
  const before = new CardRegistry(stateDir)

  before.flag(flagOf())
  before.close()
  await new WriterRun({ ...JOB, stateDir }, new ExecutionCatalog([agent(answering(cardOf(1)))])).run()

  const after = new CardRegistry(stateDir)

  assert.deepEqual([after.find(1)?.state, after.find(1)?.title], ['open', 'The card of flag 1'])
  after.close()
})

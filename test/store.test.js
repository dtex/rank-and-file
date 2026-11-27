import test from 'node:test'
import assert from 'node:assert/strict'
import { withLock } from '../services/store.js'
import { testStore } from './helpers/db.js'

const game = (uuid, end, over = {}) => ({
  uuid, url: `https://www.chess.com/game/live/${uuid}`, end, rated: true, timeClass: 'blitz', timeControl: '300', rules: 'chess',
  white: { name: 'me', rating: 800, result: 'win' }, black: { name: 'them', rating: 800, result: 'resigned' }, moves: ['e4', 'e5'], ...over,
})

test('a new user starts with empty progress, and saved progress comes back', async () => {
  const { store } = await testStore()
  const p = await store.loadProgress()
  assert.deepEqual(p.missions, {})
  p.settings.usernames.chesscom = 'me'
  p.missions.kp = { status: 'active', side: 'w', startedAt: 1, games: [] }
  await store.saveProgress(p)
  assert.deepEqual(await store.loadProgress(), p)
})

test('games are stored once, oldest first, and keep their verdicts', async () => {
  const { store } = await testStore()
  const first = await store.saveMonth('2026-10', [game('b', 200), game('a', 100)], 'etag-1')
  assert.deepEqual(first.added.map((g) => g.uuid), ['b', 'a'])
  const again = await store.saveMonth('2026-10', [game('a', 100), game('c', 300, { verdict: { type: 'history' } })], 'etag-2')
  assert.deepEqual(again.added.map((g) => g.uuid), ['c'])
  assert.equal(again.lengthened, 0)
  assert.deepEqual(await store.loadMonths(), { '2026-10': 'etag-2' })

  const all = await store.loadAllGames()
  assert.deepEqual(all.map((g) => g.uuid), ['a', 'b', 'c'])
  assert.equal('verdict' in all[0], false, 'an unjudged game has no verdict')
  assert.deepEqual(all[2].verdict, { type: 'history' })

  all[0].verdict = { type: 'counted', node: 'kp' }
  await store.saveVerdicts([all[0]])
  assert.deepEqual((await store.loadAllGames())[0].verdict, { type: 'counted', node: 'kp' })
})

test('a longer copy of a stored game replaces it and keeps the verdict; a shorter or equal one changes nothing', async () => {
  const { store } = await testStore()
  const moves = (n) => Array.from({ length: n }, (_, i) => `m${i}`)
  await store.saveGames([game('a', 100, { moves: moves(30), verdict: { type: 'history' } })])

  const longer = await store.saveGames([game('a', 100, { moves: moves(60) }), game('b', 200)])
  assert.deepEqual(longer.added.map((g) => g.uuid), ['b'], 'added holds only the new game')
  assert.equal(longer.lengthened, 1)
  let [a] = await store.loadAllGames()
  assert.equal(a.moves.length, 60)
  assert.deepEqual(a.verdict, { type: 'history' })

  const same = await store.saveGames([game('a', 100, { moves: moves(60), timeControl: 'changed' })])
  const shorter = await store.saveMonth('2026-10', [game('a', 100, { moves: moves(12), timeControl: 'changed' })], 'e')
  assert.deepEqual([same, shorter], [{ added: [], lengthened: 0 }, { added: [], lengthened: 0 }])
  ;[a] = await store.loadAllGames()
  assert.equal(a.moves.length, 60)
  assert.equal(a.timeControl, '300')
})

test('one user never sees or resets another user\'s data', async () => {
  const a = await testStore()
  const b = await testStore()
  await a.store.saveMonth('2026-10', [game('shared', 100)], 'ea')
  await b.store.saveMonth('2026-10', [game('shared', 100)], 'eb')
  const pa = await a.store.loadProgress()
  pa.settings.usernames.chesscom = 'alice'
  await a.store.saveProgress(pa)

  await b.store.reset()
  assert.equal((await b.store.loadAllGames()).length, 0)
  assert.deepEqual(await b.store.loadMonths(), {})
  assert.equal((await a.store.loadAllGames()).length, 1)
  assert.equal((await a.store.loadProgress()).settings.usernames.chesscom, 'alice')
})

test('withLock runs work for one key in order and survives a failure', async () => {
  const seen = []
  const slow = withLock('k', async () => { await new Promise((r) => setTimeout(r, 20)); seen.push(1) })
  const fails = withLock('k', async () => { seen.push(2); throw new Error('boom') })
  const last = withLock('k', async () => { seen.push(3); return 'ok' })
  await slow
  await assert.rejects(fails, /boom/)
  assert.equal(await last, 'ok')
  assert.deepEqual(seen, [1, 2, 3])
})

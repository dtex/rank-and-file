import test from 'node:test'
import assert from 'node:assert/strict'
import { isFinished, trimGame } from '../services/lichess.js'
import { judge, userResult, userSide } from '../services/matcher.js'
import { pullGames } from '../services/sync.js'
import { testStore } from './helpers/db.js'
import { signIn, testApp, uniqueEmail } from './helpers/app.js'

const T = 1_760_000_000
const raw = (over = {}) => ({
  id: 'abcd1234', rated: true, variant: 'standard', speed: 'blitz', perf: 'blitz',
  createdAt: T * 1000, lastMoveAt: (T + 600) * 1000, status: 'resign', winner: 'white',
  players: { white: { user: { name: 'Dtex', id: 'dtex' }, rating: 1500 }, black: { user: { name: 'someone', id: 'someone' }, rating: 1490 } },
  moves: 'e4 e5 Nf3 Nc6 Bc4', clock: { initial: 300, increment: 3, totalTime: 420 },
  ...over,
})

test('a Lichess game is trimmed to the same record as a chess.com one', () => {
  const g = trimGame(raw())
  assert.deepEqual(g, {
    uuid: 'lichess:abcd1234', site: 'lichess', url: 'https://lichess.org/abcd1234', start: T, end: T + 600,
    rated: true, timeClass: 'blitz', timeControl: '300+3', rules: 'chess',
    white: { name: 'Dtex', rating: 1500, result: 'win' }, black: { name: 'someone', rating: 1490, result: 'resigned' },
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
  })
  const settings = { usernames: { lichess: 'dtex' }, timeClasses: ['blitz'], ratedOnly: true }
  assert.equal(userSide(g, settings), 'w')
  assert.equal(userResult(g, 'w'), 'win')
  assert.equal(userResult(g, 'b'), 'loss')

  const drawn = trimGame(raw({ winner: undefined, status: 'draw' }))
  assert.deepEqual([userResult(drawn, 'w'), userResult(drawn, 'b')], ['draw', 'draw'])
  assert.equal(userResult(trimGame(raw({ winner: undefined, status: 'stalemate' })), 'b'), 'draw')
})

test('Lichess speeds become the time controls in Settings, and variants never count', () => {
  const speeds = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence']
  assert.deepEqual(speeds.map((speed) => trimGame(raw({ speed })).timeClass), ['bullet', 'bullet', 'blitz', 'rapid', 'rapid', 'daily'])
  assert.equal(trimGame(raw({ clock: undefined, daysPerTurn: 2, speed: 'correspondence' })).timeControl, '1/172800')

  const settings = { usernames: { lichess: 'dtex' }, timeClasses: ['blitz'], ratedOnly: true }
  const variant = trimGame(raw({ variant: 'chess960' }))
  assert.deepEqual(variant.moves, [])
  assert.match(judge(variant, { node: null, side: 'w', settings }).reason, /chess960 is not standard chess/)
  const setUp = trimGame(raw({ variant: 'fromPosition' }))
  assert.equal(judge(setUp, { node: null, side: 'w', settings }).reason, 'started from a set position')
  assert.equal(trimGame(raw({ players: { white: { aiLevel: 3 }, black: raw().players.black } })).white.name, 'Stockfish level 3')
})

test('a Lichess game still being played, or never played, is not taken', () => {
  const now = (T + 1000) * 1000
  assert.equal(isFinished(raw(), now), true)
  for (const status of ['created', 'started', 'aborted', 'noStart']) assert.equal(isFinished(raw({ status }), now), false, status)
  assert.equal(isFinished(raw({ lastMoveAt: now + 1 }), now), false, 'ends in the future')
  assert.equal(isFinished({}, now), false)
})

/** A stand-in for both sites. `lichess` is the list of raw games; requests are recorded. */
function fakeSites({ lichess = [], chesscom = {}, lichessStatus = 200 } = {}) {
  const calls = []
  const impl = async (url, { headers }) => {
    calls.push(url)
    const u = new URL(url)
    if (u.hostname === 'lichess.org') {
      assert.equal(headers.Accept, 'application/x-ndjson')
      assert.ok(headers['User-Agent'])
      if (lichessStatus !== 200) return new Response('', { status: lichessStatus })
      const since = Number(u.searchParams.get('since') ?? 0)
      const perf = u.searchParams.get('perfType')
      const games = lichess.filter((g) => g.createdAt >= since && (!perf || g.speed === perf))
      return new Response(`${games.map((g) => JSON.stringify(g)).join('\n')}\n`, { status: 200 })
    }
    if (url.endsWith('/games/archives')) {
      return Response.json({ archives: Object.keys(chesscom).map((k) => `https://api.chess.com/pub/player/x/games/${k.replace('-', '/')}`) })
    }
    const key = url.match(/(\d{4})\/(\d{2})$/).slice(1).join('-')
    return Response.json({ games: chesscom[key] })
  }
  return { impl, calls }
}

test('Lichess games are trimmed to the first 30 moves, and shorter games are kept whole', () => {
  const moves = (n) => Array.from({ length: n }, (_, i) => `m${i}`).join(' ')
  assert.equal(trimGame(raw({ moves: moves(90) })).moves.length, 60)
  assert.equal(trimGame(raw({ moves: moves(41) })).moves.length, 41)
})

test('pullGames takes the newest Lichess games first, then only what is new', async () => {
  const { store } = await testStore()
  const settings = { usernames: { lichess: 'dtex' } }
  const lichess = [raw({ id: 'g1' }), raw({ id: 'g2', createdAt: (T + 1000) * 1000, lastMoveAt: (T + 1500) * 1000 })]
  const api = fakeSites({ lichess })

  const first = await pullGames({ store, settings, fetchImpl: api.impl })
  assert.deepEqual(first.added.map((g) => g.uuid), ['lichess:g1', 'lichess:g2'])
  assert.equal(api.calls.length, 1)
  assert.match(api.calls[0], /max=1000/)

  // A correspondence game that started long before the newest game and has only now finished.
  lichess.push(raw({ id: 'slow', speed: 'correspondence', createdAt: (T - 40 * 86400) * 1000, lastMoveAt: (T + 2000) * 1000 }))
  lichess.push(raw({ id: 'g3', createdAt: (T + 3000) * 1000, lastMoveAt: (T + 3600) * 1000 }))
  api.calls.length = 0
  const second = await pullGames({ store, settings, fetchImpl: api.impl })
  assert.deepEqual(second.added.map((g) => g.uuid), ['lichess:slow', 'lichess:g3'])
  assert.equal(api.calls.length, 2)
  assert.equal(new URL(api.calls[0]).searchParams.get('since'), String((T + 1000 - 86400) * 1000))
  assert.equal(new URL(api.calls[1]).searchParams.get('perfType'), 'correspondence')
  assert.equal((await store.loadAllGames()).length, 4)
})

test('games from both sites are pulled together, and one site failing does not lose the other', async () => {
  const { store } = await testStore()
  const settings = { usernames: { chesscom: 'dtexus', lichess: 'dtex' } }
  const cc = {
    uuid: 'cc1', url: 'https://www.chess.com/game/live/1', end_time: T + 100, rated: true, time_class: 'blitz', time_control: '300', rules: 'chess',
    white: { username: 'dtexus', rating: 800, result: 'win' }, black: { username: 'x', rating: 800, result: 'resigned' }, pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
  }
  const down = await pullGames({ store, settings, fetchImpl: fakeSites({ chesscom: { '2025-10': [cc] }, lichessStatus: 429 }).impl })
  assert.deepEqual(down.added.map((g) => g.uuid), ['cc1'])
  assert.match(down.problem, /Lichess is rate limiting/)

  const up = await pullGames({ store, settings, fetchImpl: fakeSites({ chesscom: { '2025-10': [cc] }, lichess: [raw()] }).impl })
  assert.deepEqual(up.added.map((g) => g.uuid), ['lichess:abcd1234'])
  assert.equal(up.problem, null)

  await assert.rejects(pullGames({ store, settings: { usernames: { lichess: 'nobody' } }, fetchImpl: fakeSites({ lichessStatus: 404 }).impl }), /no player called nobody/)
})

test('either site is enough to start; adding one keeps progress, changing one starts over', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx, uniqueEmail(), { ready: false })
  await c.post('/api/account/consent', { age: true, terms: true })
  const base = { timeClasses: ['blitz'], ratedOnly: true }
  assert.equal((await c.put('/api/settings', { ...base, usernames: {} })).statusCode, 400)
  assert.equal((await c.put('/api/settings', { ...base, usernames: { lichess: 'not a name' } })).statusCode, 400)

  assert.equal((await c.put('/api/settings', { ...base, usernames: { lichess: 'dtex' } })).statusCode, 200)
  assert.equal((await c.get('/api/me')).json().username, 'dtex on Lichess')
  assert.equal((await c.get('/api/state')).statusCode, 200)

  const both = await c.put('/api/settings', { ...base, usernames: { chesscom: 'dtexus', lichess: 'DTEX' } })
  assert.equal(both.statusCode, 200, 'adding a site, or changing only the capitals, needs no reset')
  assert.equal((await c.get('/api/state')).json().accounts, 'dtexus on chess.com, DTEX on Lichess')

  for (const usernames of [{ chesscom: 'dtexus', lichess: 'other' }, { chesscom: 'dtexus' }]) {
    const res = await c.put('/api/settings', { ...base, usernames })
    assert.deepEqual([res.statusCode, res.json().needsReset], [409, true])
  }
  assert.equal((await c.put('/api/settings', { ...base, usernames: { chesscom: 'dtexus' }, reset: true })).statusCode, 200)
  assert.deepEqual((await c.get('/api/settings')).json().settings.usernames, { chesscom: 'dtexus', lichess: '' })
})

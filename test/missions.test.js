import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTree } from '../services/tree.js'
import { candidates, fillSlots, processGames, switchMission } from '../services/missions.js'
import { fogId, openingView, stateView } from '../services/views.js'

const tree = loadTree()
const T0 = 1795000000
let n = 0
const game = (moves, { as = 'w', ...over } = {}) => {
  n++
  const me = { name: 'me', rating: 800, result: 'win' }
  const opp = { name: `opp${n}`, rating: 800, result: 'resigned' }
  return {
    uuid: `g${n}`, end: T0 + n * 100, rated: true, timeClass: 'blitz', timeControl: '300', rules: 'chess',
    white: as === 'w' ? me : opp, black: as === 'w' ? opp : me, moves: moves.split(' '), ...over,
  }
}
const fresh = () => {
  const progress = {
    createdAt: T0, settings: { username: 'me', timeClasses: ['blitz'], ratedOnly: true },
    missions: {}, slots: { w: null, b: null }, events: [],
  }
  fillSlots(tree, progress, T0)
  return progress
}

test('a new player starts with 1.e4 as White and 1...e5 as Black', () => {
  const p = fresh()
  assert.deepEqual(p.slots, { w: 'kp', b: 'open' })
})

test('games before the start are history and never count', () => {
  const p = fresh()
  const old = game('e4 e5', { end: T0 - 5 })
  processGames(tree, p, [old])
  assert.equal(old.verdict.type, 'history')
  assert.equal(p.missions.kp.games.length, 0)
})

test('counting, completion and the next mission', () => {
  const p = fresh()
  const games = Array.from({ length: 12 }, () => game('e4 e5 Nf3 Nc6'))
  const { events } = processGames(tree, p, games)
  assert.equal(p.missions.kp.status, 'done')
  assert.equal(p.missions.kp.games.length, 10)
  assert.equal(games[9].verdict.count, 10)
  assert.equal(events.length, 1)
  assert.equal(events[0].next, 'knight', 'next White opening follows the main line')
  // Games 11 and 12 came after the completing game, so they count for the new mission.
  assert.equal(p.slots.w, 'knight')
  assert.equal(p.missions.knight.games.length, 2)
})

test('the next opening uncovered is the one the recent games reach most', () => {
  const p = fresh()
  // History: mostly the Bishop's Opening as White, mostly the Sicilian as Black.
  const history = [
    ...Array.from({ length: 3 }, (_, i) => game('e4 e5 Bc4', { end: T0 - 900 + i })),
    game('e4 e5 Nf3', { end: T0 - 800 }),
    ...Array.from({ length: 3 }, (_, i) => game('e4 c5', { as: 'b', end: T0 - 700 + i })),
    game('e4 e6', { as: 'b', end: T0 - 600 }),
    // Reached with the other colour, so it says nothing about what I play.
    ...Array.from({ length: 5 }, (_, i) => game('e4 e5 Nc3', { as: 'b', end: T0 - 500 + i })),
  ]
  const white = Array.from({ length: 10 }, () => game('e4 e5'))
  const black = Array.from({ length: 8 }, () => game('e4 e5', { as: 'b' }))
  const { events } = processGames(tree, p, [...history, ...white, ...black])
  assert.deepEqual(events.map((e) => e.next), ['bishop', 'sicilian'])
  assert.deepEqual(p.slots, { w: 'bishop', b: 'sicilian' })
})

test('only the last 1000 games decide the next opening', () => {
  const p = fresh()
  const old = Array.from({ length: 5 }, (_, i) => game('e4 e5 Bc4', { end: T0 - 5000 + i }))
  const filler = Array.from({ length: 999 }, (_, i) => game('e4 e5', { as: 'b', end: T0 - 4000 + i }))
  const recent = game('e4 e5 Nc3', { end: T0 - 10 })
  p.missions.kp.status = 'done'
  p.slots.w = null
  // The five Bishop's Opening games are older than the window; one Vienna game is inside it.
  assert.equal(fillSlots(tree, p, T0, Infinity, [...old, ...filler, recent])[0].id, 'vienna')
})

test('a game is only judged once', () => {
  const p = fresh()
  const g = game('e4 e5')
  processGames(tree, p, [g])
  processGames(tree, p, [g])
  assert.equal(p.missions.kp.games.length, 1)
})

test('games as Black are judged against the Black mission', () => {
  const p = fresh()
  const hit = game('e4 e5 Nf3', { as: 'b' })
  const miss = game('d4 d5', { as: 'b' })
  const mine = game('e4 c5', { as: 'b' })
  processGames(tree, p, [hit, miss, mine])
  assert.equal(hit.verdict.type, 'counted')
  assert.deepEqual([miss.verdict.type, miss.verdict.move], ['opponent_left', '1.d4'])
  assert.deepEqual([mine.verdict.type, mine.verdict.move], ['you_left', '1...c5'])
  assert.equal(p.missions.kp.games.length, 0)
})

test('resuming a parked mission parks the current one and keeps its count', () => {
  const p = fresh()
  // A mission ends up parked when a membership lapses or returns; set one up directly.
  p.missions.qp = { status: 'parked', side: 'w', startedAt: T0, since: T0, games: [] }
  processGames(tree, p, [game('e4 e5')])
  switchMission(tree, p, 'qp', T0 + 5000)
  assert.equal(p.slots.w, 'qp')
  assert.equal(p.missions.kp.status, 'parked')
  assert.equal(p.missions.kp.games.length, 1)
  switchMission(tree, p, 'kp', T0 + 7000)
  assert.equal(p.slots.w, 'kp')
  assert.equal(p.missions.qp.status, 'parked')
  // Games that ended before the switch back do not count.
  const early = game('e4 e5', { end: T0 + 6500 })
  processGames(tree, p, [early])
  assert.equal(early.verdict.type, 'before_mission')
})

test('nobody can choose a hidden opening, not even a fog tile next to their map', () => {
  const p = fresh()
  const before = structuredClone(p)
  assert.ok(candidates(tree, p, 'w').some((n) => n.id === 'qp'))
  assert.throws(() => switchMission(tree, p, 'qp', T0 + 1), /still hidden/)
  assert.throws(() => switchMission(tree, p, 'italian', T0 + 1), /still hidden/)
  assert.deepEqual(p, before)
})

test('the map view lists the moves an opening skips past its parent', () => {
  const view = stateView(tree, fresh(), [])
  for (const n of view.nodes.slice(1)) {
    const node = tree.byId.get(n.id)
    const gap = node.depth - tree.byId.get(node.parent).depth - 1
    assert.equal(n.via.length, gap, n.id)
  }
  // Van't Kruijs is Black's 1...e5 straight under the starting position: White's 1.e3 is the move in between.
  const hidden = stateView(tree, fresh(), []).fog.find((f) => f.fid === fogId('vantkruijs'))
  assert.equal(hidden.skip, 1)
  const p = fresh()
  p.missions.vantkruijs = { status: 'parked', games: [] }
  assert.deepEqual(stateView(tree, p, []).nodes.find((n) => n.id === 'vantkruijs').via, ['1.e3'])
})

test('the map view never names a hidden opening', () => {
  const p = fresh()
  const hidden = game('e4 c5 Nf3', { as: 'w' })
  processGames(tree, p, [hidden])
  const view = stateView(tree, p, [hidden])
  const text = JSON.stringify(view)
  assert.equal(text.includes('Sicilian'), false)
  assert.equal(text.includes('sicilian'), false)
  assert.deepEqual(view.latest[0].opening, { hidden: true })
  assert.ok(view.fog.length > 0)
  const tile = view.fog.find((f) => f.fid === fogId('sicilian'))
  assert.deepEqual(tile, { fid: fogId('sicilian'), parent: 'kp', side: 'b', skip: 0 })
  assert.equal(openingView(tree, p, [hidden], 'sicilian'), null)
})

test('opening view reports reach rate and where other games went', () => {
  const p = fresh()
  const games = [game('e4 e5'), game('e4 c5'), game('d4 d5'), game('d4 Nf6')]
  processGames(tree, p, games)
  const v = openingView(tree, p, games, 'kp')
  assert.equal(v.stats.reached, 2)
  assert.equal(v.stats.of, 4)
  assert.deepEqual(v.stats.elsewhere, [{ move: '1.d4', mine: true, count: 2 }])
  assert.deepEqual(v.yourMoves, ['1.e4'])
})

test('the opening page carries the history, one entry per paragraph', () => {
  const p = fresh()
  const v = openingView(tree, p, [], 'kp')
  assert.deepEqual(v.history, tree.byId.get('kp').history.split('\n\n'))
  assert.ok(v.history.length >= 1 && v.history.every((para) => para && !para.includes('\n')))
  // An opening without one gets an empty list, so the page leaves the section out.
  const bare = { ...tree, byId: new Map([...tree.byId, ['kp', { ...tree.byId.get('kp'), history: undefined }]]) }
  assert.deepEqual(openingView(bare, p, [], 'kp').history, [])
})

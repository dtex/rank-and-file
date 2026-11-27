import test from 'node:test'
import assert from 'node:assert/strict'
import { compileCheck, evaluate } from '../services/checks.js'
import { loadTree } from '../services/tree.js'
import { fillSlots, processGames } from '../services/missions.js'
import { gameAdvice, updateAdviceMissions } from '../services/advice.js'
import { gamesView, openingView, stateView } from '../services/views.js'

const tree = loadTree()
const T0 = 1795000000
let n = 0
const game = (moves, { as = 'w', ...over } = {}) => {
  n++
  const me = { name: 'me', rating: 800, result: 'win' }
  const opp = { name: `opp${n}`, rating: 800, result: 'resigned' }
  return {
    uuid: `a${n}`, end: T0 + n * 100, rated: true, timeClass: 'blitz', timeControl: '300', rules: 'chess',
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
const run = (raw, moves, side = 'w', at = 1) => evaluate(compileCheck(raw), { moves: moves.split(' '), side, at })

// 1.e4 with knights first and castling on move 4: both checkable ideas of 1.e4 followed.
const GOOD = 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 d6 c3 O-O Re1 a6 a4 Ba7 h3 h6 Nbd2 Re8'
// Bishop out first and no castling in ten moves: both missed.
const BAD = 'e4 e5 Bc4 Nc6 Qh5 g6 Qf3 Nf6 Ne2 Bg7 d3 d6 h3 O-O g4 a6 a4 Be6 Nbc3 Nd4'

test('play: a move by a deadline, and no verdict when the game ends first', () => {
  const castle = { play: 'castle', by: 10 }
  assert.deepEqual(run(castle, GOOD), { status: 'pass', score: 1, note: '4.O-O' })
  assert.equal(run(castle, BAD).status, 'fail')
  assert.equal(run(castle, 'e4 e5 Nf3 Nc6 Bc4 Bc5').status, 'na', 'six plies cannot show whether you castle by move 10')
})

test('a deadline can be as late as move 20, judged on a game that long', () => {
  const late = { play: 'castle', by: 20 }
  const shuffle = (n) => Array.from({ length: n }, (_, i) => ['Nf3', 'Nf6', 'Ng1', 'Ng8'][i % 4]).join(' ')
  assert.equal(run(late, `e4 e5 ${shuffle(32)} Be2 Be7 Nf3 Nf6 O-O O-O`).status, 'pass', 'castled on move 20 of a 40-ply game')
  assert.equal(run(late, `e4 e5 ${shuffle(38)}`).status, 'fail', '40 plies without castling')
  assert.equal(run(late, `e4 e5 ${shuffle(28)}`).status, 'na', 'a game kept to move 15 cannot show it')
})

test('first/then: order matters, and it does not apply when neither happened', () => {
  const order = { first: 'N*', then: 'B*' }
  assert.equal(run(order, GOOD).status, 'pass')
  assert.deepEqual(run(order, BAD), { status: 'fail', score: 0, note: '2.Bc4 came first' })
  assert.equal(run(order, 'e4 e5 d4 exd4').status, 'na')
})

test('when: only applies once the opponent plays the trigger', () => {
  const reply = { when: 'Ng5', play: 'd5' }
  const at = 6 // after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6
  assert.equal(run(reply, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5', 'b', at).status, 'pass')
  assert.deepEqual(run(reply, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 h6', 'b', at), { status: 'fail', score: 0, note: 'after 4.Ng5 you played 4...h6' })
  assert.equal(run(reply, 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5', 'b', at).status, 'na')
  assert.equal(run(reply, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', 'b', at).status, 'na', 'no reply was played')
  // Your own move never counts as the trigger.
  assert.equal(run({ when: 'e5', play: 'd6', within: 2 }, 'e4 Nf6 Nc3 e5 Nf3 Nc6', 'b', 2).status, 'na')
  // `next` wants the trigger straight after the opening.
  assert.equal(run({ when: 'Nf3', next: true, play: 'Nc6' }, 'e4 e5 Bc4 Nf6 Nf3 d6', 'b', 2).status, 'na')
})

test('avoid: with a trigger and without', () => {
  const noRecapture = { when: 'Ng5 d5 exd5', avoid: 'Nxd5' }
  assert.equal(run(noRecapture, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5', 'b', 6).status, 'fail')
  assert.equal(run(noRecapture, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5', 'b', 6).status, 'pass')
  const queen = { avoid: 'Q*', by: 6 }
  assert.equal(run(queen, 'e4 e5 Nf3 Qf6 Nc3 c6 d4 d6 Be2 Be7 O-O h6', 'b', 2).status, 'fail')
  // Queen captures are trades and recaptures, not "bringing the queen out".
  assert.equal(run(queen, 'e4 e5 d4 exd4 Qxd4 Nc6 Qe3 Nf6 Nc3 Bb4 Bd2 O-O', 'b', 2).status, 'pass')
})

test('setup: part credit for part of the setup', () => {
  const setup = { setup: ['Nf6', 'Be7', 'O-O'], by: 6 }
  assert.equal(run(setup, 'e4 e5 Nf3 d6 d4 Nf6 Nc3 Be7 Bc4 O-O O-O c6', 'b', 4).status, 'pass')
  const part = run(setup, 'e4 e5 Nf3 d6 d4 Nf6 Nc3 Bg4 Bc4 Nc6 O-O a6', 'b', 4)
  assert.equal(part.status, 'partial')
  assert.equal(Math.round(part.score * 100), 33)
  assert.match(part.note, /Be7, O-O/)
})

test('move tokens ignore check marks and disambiguation', () => {
  assert.equal(run({ play: 'Nd2', by: 3 }, 'd4 d5 Nf3 Nf6 Nbd2 e6').status, 'pass')
  assert.equal(run({ play: 'Bb4', within: 1 }, 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+', 'b', 11).status, 'pass')
})

test('a bad check in the tree is rejected with a useful message', () => {
  assert.throws(() => compileCheck({ play: 'Zz9', by: 3 }, 'kp'), /not a move/)
  assert.throws(() => compileCheck({ play: 'O-O' }, 'kp'), /by or within/)
  assert.throws(() => compileCheck({ play: 'O-O', by: 31 }, 'kp'), /1 to 30.*stored/)
  assert.throws(() => compileCheck({ play: 'O-O', avoid: 'f3', by: 5 }, 'kp'), /exactly one/)
})

test('a game is scored against the uncovered openings it reached, and nothing hidden', () => {
  const p = fresh()
  const g = game(GOOD)
  const a = gameAdvice(tree, p, g)
  // The game goes through 1.e4, 2.Nf3 and the Italian, but only 1.e4 is uncovered.
  assert.deepEqual(a.openings.map((o) => o.id), ['kp'])
  assert.equal(a.score, 100)
  assert.equal(gameAdvice(tree, p, game(BAD)).score, 0)
  // As Black the White openings do not apply.
  assert.deepEqual(gameAdvice(tree, p, game(GOOD, { as: 'b' })).openings.map((o) => o.id), ['open'])
  const text = JSON.stringify(gamesView(tree, p, [g]))
  assert.equal(text.includes('Italian'), false)
  assert.equal(text.includes("King's Knight"), false)
})

test('games from before an opening was uncovered are not scored', () => {
  const p = fresh()
  assert.equal(gameAdvice(tree, p, game(BAD, { end: T0 - 10 })), null)
  assert.equal(gameAdvice(tree, p, game(BAD, { timeClass: 'bullet' })), null, 'ineligible games are left out too')
})

test('four poor games start an advice mission; it is done when the last four average the target again', () => {
  const p = fresh()
  const games = [game(GOOD), game(BAD), game(BAD), game(BAD)]
  processGames(tree, p, games)
  let events = updateAdviceMissions(tree, p, games)
  assert.deepEqual(events.map((e) => [e.type, e.node, e.average]), [['advice_started', 'kp', 25]])
  assert.equal(p.advice.missions.kp.status, 'active')
  assert.equal(p.slots.w, 'kp', 'the opening mission carries on')

  let view = stateView(tree, p, games)
  assert.equal(view.missions.advice.length, 1)
  assert.deepEqual([view.missions.advice[0].played, view.missions.advice[0].startAverage], [0, 25])
  const card = view.events.find((e) => e.type === 'advice_started')
  assert.equal(card.missed.length, 2)
  assert.deepEqual([card.missed[0].followed, card.missed[0].of], [1, 4])

  // Nothing new: running again changes nothing.
  assert.deepEqual(updateAdviceMissions(tree, p, games), [])

  // Two good games bring the last four to 50%, which is still short.
  games.push(game(GOOD), game(GOOD))
  assert.deepEqual(updateAdviceMissions(tree, p, games), [])
  view = stateView(tree, p, games)
  assert.deepEqual([view.missions.advice[0].played, view.missions.advice[0].current], [2, 50])

  // A third makes it 75%, with a poor game still among the four.
  games.push(game(GOOD))
  events = updateAdviceMissions(tree, p, games)
  assert.deepEqual(events.map((e) => [e.type, e.average]), [['advice_done', 75]])
  assert.equal(p.advice.missions.kp.status, 'done')
  assert.equal(stateView(tree, p, games).missions.advice.length, 0)

  // It can come back if the last four slip again.
  games.push(game(BAD), game(BAD))
  events = updateAdviceMissions(tree, p, games)
  assert.deepEqual(events.map((e) => e.type), ['advice_started'])
  assert.equal(p.advice.missions.kp.rounds, 2)
})

test('fewer than four scored games never start a mission, and a target of 0 switches them off', () => {
  const p = fresh()
  const games = [game(BAD), game(BAD), game(BAD)]
  assert.deepEqual(updateAdviceMissions(tree, p, games), [])
  const off = fresh()
  off.settings.adviceThreshold = 0
  const many = [game(BAD), game(BAD), game(BAD), game(BAD), game(BAD)]
  assert.deepEqual(updateAdviceMissions(tree, off, many), [])
})

test('the opening page shows how each idea fared over the last four games', () => {
  const p = fresh()
  const games = [game(GOOD), game(GOOD), game(BAD), game(GOOD), game(GOOD)]
  const v = openingView(tree, p, games, 'kp')
  assert.equal(v.advice.average, 75)
  assert.deepEqual(v.ideas.map((i) => [i.checked, i.followed, i.of]), [[true, 3, 4], [true, 3, 4], [false, 0, 0]])
  assert.equal(v.advice.recent.length, 4)
  assert.equal(v.advice.recent[0].advice.openings[0].checks[0].status, 'pass')
})

test('every opening on the map has at least one idea that can be checked', () => {
  const none = tree.nodes.filter((nd) => nd.depth && !nd.advice.some((a) => a.check)).map((nd) => nd.id)
  assert.deepEqual(none, [])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTree } from '../services/tree.js'
import { STRUGGLE_MIN_GAMES, TREND_WINDOW, ratingBands, scoreTrend, struggling } from '../services/stats.js'

const tree = loadTree()
const kp = tree.byId.get('kp') // 1.e4, played as White
const settings = { usernames: { chesscom: 'me' }, timeClasses: ['blitz'], ratedOnly: true }
const RESULT = { win: ['win', 'resigned'], loss: ['resigned', 'win'], draw: ['agreed', 'agreed'] }
let n = 0
/** A game that reaches 1.e4 with me as White, rated 1000, against an opponent rated `opp`. */
const game = (opp, result = 'win', over = {}) => {
  n++
  const [mine, theirs] = RESULT[result]
  return {
    uuid: `s${n}`, end: 1795000000 + n * 100, rated: true, timeClass: 'blitz', timeControl: '300', rules: 'chess',
    white: { name: 'me', rating: 1000, result: mine }, black: { name: `opp${n}`, rating: opp, result: theirs }, moves: ['e4', 'e5'], ...over,
  }
}
const bands = (games) => ratingBands(kp, games, settings)
const counts = (b) => [b.weaker.games, b.even.games, b.stronger.games]

test('bands split at exactly 100 points either way', () => {
  assert.deepEqual(counts(bands([game(900)])), [0, 1, 0], '100 below is still about level')
  assert.deepEqual(counts(bands([game(899)])), [1, 0, 0])
  assert.deepEqual(counts(bands([game(1100)])), [0, 1, 0], '100 above is still about level')
  assert.deepEqual(counts(bands([game(1101)])), [0, 0, 1])
})

test('the score is wins plus half the draws, and null with no games', () => {
  const b = bands([game(1000, 'win'), game(1000, 'draw'), game(1000, 'draw'), game(1000, 'loss')])
  assert.deepEqual(b.even, { games: 4, win: 1, draw: 2, loss: 1, score: 50 })
  assert.equal(b.stronger.score, null)
  assert.equal(bands([game(1000, 'win'), game(1000, 'draw'), game(1000, 'loss')]).even.score, 50)
  assert.equal(bands([game(1000, 'win'), game(1000, 'win'), game(1000, 'loss')]).even.score, 67, 'rounded to a whole percentage')
})

test('games without a rating for either side are left out of the bands and counted apart', () => {
  const b = bands([
    game(1000),
    game(null), // against the computer
    game(1200, 'win', { white: { name: 'me', result: 'win' } }),
  ])
  assert.deepEqual(counts(b), [0, 1, 0])
  assert.equal(b.unrated, 2)
})

test('ineligible games, games with the other colour and games that miss the opening are left out', () => {
  const asBlack = game(1000, 'win')
  ;[asBlack.white, asBlack.black] = [{ ...asBlack.black, name: 'opp' }, { ...asBlack.white }]
  const b = bands([
    game(1000),
    game(1000, 'win', { rated: false }),
    game(1000, 'win', { timeClass: 'bullet' }),
    game(1000, 'win', { moves: ['d4', 'd5'] }),
    asBlack,
  ])
  assert.deepEqual(counts(b), [0, 1, 0])
  assert.equal(b.unrated, 0)
})

test('the trend needs two full windows, and compares the newest with the one before', () => {
  const wins = (k) => Array.from({ length: k }, () => game(1000, 'win'))
  const losses = (k) => Array.from({ length: k }, () => game(1000, 'loss'))
  assert.equal(scoreTrend(kp, [...wins(TREND_WINDOW), ...losses(TREND_WINDOW - 1)], settings), null, '39 games')
  // Oldest first: a game too old for either window, 20 with 15 wins, then 20 with 5.
  const games = [...losses(1), ...wins(15), ...losses(5), ...wins(5), ...losses(15)]
  assert.deepEqual(scoreTrend(kp, games, settings), { recent: 25, before: 75 })
})

test('struggling takes enough games against stronger opponents and a score below 35%', () => {
  const stronger = (wins, total) => bands([...Array.from({ length: wins }, () => game(1200, 'win')), ...Array.from({ length: total - wins }, () => game(1200, 'loss'))])
  assert.equal(struggling(stronger(2, STRUGGLE_MIN_GAMES)), true, '25% over 8 games')
  assert.equal(struggling(stronger(1, STRUGGLE_MIN_GAMES - 1)), false, 'too few games to say')
  assert.equal(struggling(stronger(7, 20)), false, '35% is not below 35%')
  assert.equal(struggling(stronger(6, 20)), true, '30%')
  assert.equal(struggling(bands([game(1000, 'loss')])), false, 'no games against stronger opponents')
})

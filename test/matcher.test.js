import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTree, buildTree } from '../services/tree.js'
import { deepestNode, deviation, formatMove, judge, reached, userResult, userSide } from '../services/matcher.js'

const tree = loadTree()
const settings = { username: 'me', timeClasses: ['blitz', 'rapid'], ratedOnly: true }
let n = 0
export const game = (moves, over = {}) => ({
  uuid: `g${n++}`, end: 1795000000 + n, rated: true, timeClass: 'blitz', rules: 'chess',
  white: { name: 'Me', rating: 800, result: 'win' }, black: { name: 'opp', rating: 800, result: 'resigned' },
  moves: moves.split(' ').filter(Boolean), ...over,
})

test('the shipped tree is valid and every opening has notes', () => {
  assert.ok(tree.nodes.length > 15)
  for (const node of tree.nodes.filter((x) => x.depth)) {
    assert.ok(node.blurb && node.ideas?.length, `${node.id} has study notes`)
  }
})

test('buildTree rejects illegal lines and children that do not extend the parent', () => {
  const root = { id: 'start', parent: null, name: 's', side: null, moves: '' }
  assert.throws(() => buildTree([root, { id: 'x', parent: 'start', side: 'w', moves: 'e5' }]), /illegal move/)
  assert.throws(() => buildTree([root, { id: 'a', parent: 'start', side: 'w', moves: 'e4' }, { id: 'b', parent: 'a', side: 'b', moves: 'd4 d5' }]), /must extend/)
})

test('formatMove', () => {
  assert.equal(formatMove(5, 'Bc4'), '3.Bc4')
  assert.equal(formatMove(4, 'd6'), '2...d6')
})

test('userSide and userResult', () => {
  const g = game('e4 e5')
  assert.equal(userSide(g, 'me'), 'w')
  assert.equal(userSide(g, 'nobody'), null)
  assert.equal(userResult(g, 'w'), 'win')
  assert.equal(userResult(g, 'b'), 'loss')
  assert.equal(userResult(game('e4', { white: { name: 'me', result: 'stalemate' } }), 'w'), 'draw')
})

test('a game that reaches the position counts', () => {
  const italian = tree.byId.get('italian')
  const g = game('e4 e5 Nf3 Nc6 Bc4 Bc5 c3')
  assert.equal(reached(italian, g), true)
  assert.deepEqual(judge(g, { node: italian, side: 'w', settings }), { type: 'counted', node: 'italian' })
  assert.equal(deepestNode(tree, g).id, 'giuoco-c3', 'the deepest opening on the path wins')
})

test('a transposition still counts', () => {
  const italian = tree.byId.get('italian')
  assert.equal(reached(italian, game('e4 e5 Bc4 Nc6 Nf3 Nf6')), true)
})

test('opponent leaving the line is reported with the move', () => {
  const v = judge(game('e4 e5 Nf3 d6 d4'), { node: tree.byId.get('italian'), side: 'w', settings })
  assert.deepEqual(v, { type: 'opponent_left', node: 'italian', move: '2...d6', expected: '2...Nc6' })
})

test('the user leaving the line is reported with the move', () => {
  const v = judge(game('e4 e5 Nf3 Nc6 Bb5 a6'), { node: tree.byId.get('italian'), side: 'w', settings })
  assert.deepEqual(v, { type: 'you_left', node: 'italian', move: '3.Bb5', expected: '3.Bc4' })
})

test('as Black, White choosing another first move is the opponent leaving', () => {
  const v = judge(game('d4 d5 c4'), { node: tree.byId.get('sicilian'), side: 'b', settings })
  assert.equal(v.type, 'opponent_left')
  assert.equal(v.move, '1.d4')
  const mine = judge(game('e4 e5 Nf3'), { node: tree.byId.get('sicilian'), side: 'b', settings })
  assert.deepEqual(mine, { type: 'you_left', node: 'sicilian', move: '1...e5', expected: '1...c5' })
})

test('a game that stops while still on the line is ended_early', () => {
  assert.deepEqual(deviation(tree.byId.get('italian'), game('e4 e5 Nf3')), { ended: true })
})

test('ineligible games never count', () => {
  const node = tree.byId.get('kp')
  const j = (over) => judge(game('e4 e5', over), { node, side: 'w', settings })
  assert.equal(j({ timeClass: 'bullet' }).reason, 'bullet is switched off')
  assert.equal(j({ rated: false }).type, 'not_eligible')
  assert.equal(j({ rules: 'chess960' }).type, 'not_eligible')
  assert.equal(j({ customStart: true }).reason, 'started from a set position')
  assert.equal(judge(game('e4 e5'), { node: null, side: 'w', settings }).type, 'no_mission')
})

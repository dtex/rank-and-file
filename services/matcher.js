// Pure functions: given a game and the opening tree, say what the game reached
// and, when it missed a mission, who left the line and where.
import { Chess } from 'chess.js'
import { positionKey } from './tree.js'

const keyCache = new Map()

/** Position key after every ply of the game; index 0 is the starting position. */
export function gameKeys(game) {
  const cached = keyCache.get(game.uuid)
  if (cached && cached.n === game.moves.length) return cached.keys
  const chess = new Chess()
  const keys = [positionKey(chess.fen())]
  for (const san of game.moves) {
    try {
      chess.move(san)
    } catch {
      break // unreadable move: keep what we have
    }
    keys.push(positionKey(chess.fen()))
  }
  if (game.uuid) keyCache.set(game.uuid, { n: game.moves.length, keys })
  return keys
}

/** 'w', 'b', or null when the user did not play in this game. */
export function userSide(game, username) {
  const u = username.toLowerCase()
  if (game.white.name?.toLowerCase() === u) return 'w'
  if (game.black.name?.toLowerCase() === u) return 'b'
  return null
}

/** 'win' | 'loss' | 'draw' from the user's side. */
export function userResult(game, side) {
  const r = (side === 'w' ? game.white : game.black).result
  if (r === 'win') return 'win'
  if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(r)) return 'draw'
  return 'loss'
}

/** "3.Bc4" for White's moves, "2...d6" for Black's. Ply is 1-based. */
export function formatMove(ply, san) {
  const n = Math.ceil(ply / 2)
  return ply % 2 === 1 ? `${n}.${san}` : `${n}...${san}`
}

export function reached(node, game) {
  return gameKeys(game).includes(node.key)
}

/** The deepest opening in the tree that this game passed through, or null. */
export function deepestNode(tree, game) {
  const keys = new Set(gameKeys(game))
  let best = null
  for (const n of tree.nodes) {
    if (n.depth > 0 && keys.has(n.key) && (!best || n.depth > best.depth)) best = n
  }
  return best
}

/**
 * Where a game that did not reach `node` left its line.
 * Returns { ply, by, played, expected } or { ended: true } when the game stopped while still on the line.
 */
export function deviation(node, game) {
  const keys = gameKeys(game)
  let i = 0
  while (i + 1 < keys.length && i + 1 < node.keys.length && keys[i + 1] === node.keys[i + 1]) i++
  if (i + 1 >= keys.length) return { ended: true }
  return { ply: i + 1, by: i % 2 === 0 ? 'w' : 'b', played: game.moves[i], expected: node.plies[i] }
}

/** Why a game can't count for any mission, or null when it can. */
export function ineligibleReason(game, settings) {
  if (game.rules !== 'chess') return `${game.rules} is not standard chess`
  if (game.customStart) return 'started from a set position'
  if (settings.ratedOnly && !game.rated) return 'unrated games are switched off'
  if (!settings.timeClasses.includes(game.timeClass)) return `${game.timeClass} is switched off`
  return null
}

/**
 * Judge one game against the mission for the colour the user played.
 * `node` is that mission's opening, or null when the slot is empty.
 */
export function judge(game, { node, side, settings }) {
  const why = ineligibleReason(game, settings)
  if (why) return { type: 'not_eligible', reason: why }
  if (!node) return { type: 'no_mission' }
  if (reached(node, game)) return { type: 'counted', node: node.id }
  const d = deviation(node, game)
  if (d.ended) return { type: 'ended_early', node: node.id }
  return {
    type: d.by === side ? 'you_left' : 'opponent_left',
    node: node.id,
    move: formatMove(d.ply, d.played),
    expected: formatMove(d.ply, d.expected),
  }
}

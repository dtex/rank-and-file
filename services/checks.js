// Machine-checkable versions of the study notes. Each opening in data/tree.json
// can carry one check per idea; a check reads the game's moves and says whether
// the advice was followed. Pure functions, no chess engine needed: SAN is enough.
//
// A check is one of
//   { play: "Nc6|Nf6" }             you play one of these moves
//   { setup: ["Nf6", "Be7", "O-O"] } you play all of these; part credit for some
//   { avoid: "Q*" }                 you do not play any of these
//   { first: "N*", then: "B*" }     the first comes before the second
// with a time limit, counted in your own moves:
//   by: 10        by move 10 of the game
//   within: 2     within 2 moves of reaching the opening (or of the trigger)
// and optionally a trigger, which makes the check apply only when it happens:
//   when: "d4 exd4 cxd4"   these plies in a row, after the opening is reached,
//                          the last of them played by your opponent
//   next: true             the trigger must come straight after the opening
//
// Move tokens are SAN without check marks. "N*" is any non-capturing knight
// move, "castle" is either castling, "!d5" is anything except d5, and "|"
// separates alternatives. "Nd2" also matches Nbd2 and Nxd2.
import { MAX_PLIES } from './chesscom.js'

const SAN = /^(O-O(-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|([a-h]x)?[a-h][1-8](=[QRBN])?)$/
const PIECE_MOVE = /^([KQRBN])[a-h]?[1-8]?(x?)([a-h][1-8])$/

/** SAN without check marks or disambiguation: "Nbxd2+" becomes "Nxd2". */
function norm(san) {
  const s = san.replace(/[+#!?]/g, '')
  const m = s.match(PIECE_MOVE)
  return m ? m[1] + m[2] + m[3] : s
}

function compileAlt(tok, where) {
  if (tok.startsWith('!')) {
    const f = compileAlt(tok.slice(1), where)
    return (san) => !f(san)
  }
  if (tok === 'castle') return (san) => san.startsWith('O-O')
  if (/^[KQRBN]\*$/.test(tok)) return (san) => san[0] === tok[0] && !san.includes('x')
  if (!SAN.test(tok)) throw new Error(`${where}: "${tok}" is not a move`)
  const want = norm(tok)
  const loose = PIECE_MOVE.test(tok) && !tok.includes('x')
  return (san) => {
    const n = norm(san)
    return n === want || (loose && n.replace('x', '') === want)
  }
}

function matcher(token, where) {
  if (typeof token !== 'string' || !token) throw new Error(`${where}: expected a move`)
  const alts = token.split('|').map((t) => compileAlt(t, where))
  const match = (san) => alts.some((f) => f(san))
  match.text = token.replace(/\|/g, ' or ').replace(/castle/g, 'castling')
  return match
}

/** Validate a raw check from tree.json and turn its tokens into matchers. */
export function compileCheck(raw, where = 'check') {
  const kinds = ['play', 'setup', 'avoid', 'first'].filter((k) => raw[k] !== undefined)
  if (kinds.length !== 1) throw new Error(`${where}: needs exactly one of play, setup, avoid or first/then`)
  const kind = kinds[0] === 'first' ? 'order' : kinds[0]
  const c = { kind }
  if (kind === 'order') {
    c.first = matcher(raw.first, where)
    c.then = matcher(raw.then, where)
    if (raw.when || raw.by || raw.within) throw new Error(`${where}: first/then takes no when, by or within`)
    return c
  }
  if (kind === 'setup') {
    if (!Array.isArray(raw.setup) || raw.setup.length < 2) throw new Error(`${where}: setup needs a list of moves`)
    c.moves = raw.setup.map((t) => matcher(t, where))
  } else {
    c.move = matcher(raw[kind], where)
  }
  if (raw.when) {
    c.when = raw.when.trim().split(/\s+/).map((t) => matcher(t, where))
    c.next = raw.next === true
    if (raw.by) throw new Error(`${where}: use within, not by, together with when`)
    c.within = raw.within ?? 1
  } else {
    if (raw.next) throw new Error(`${where}: next only makes sense with when`)
    if (!raw.by === !raw.within) throw new Error(`${where}: needs either by or within`)
    c.by = raw.by
    c.within = raw.within
  }
  for (const n of [c.by, c.within]) {
    if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= MAX_PLIES / 2)) {
      throw new Error(`${where}: by and within must be whole moves from 1 to ${MAX_PLIES / 2}, the part of each game that is stored`)
    }
  }
  return c
}

const NA = { status: 'na', score: null, note: '' }
const pass = (note = '') => ({ status: 'pass', score: 1, note })
const fail = (note = '') => ({ status: 'fail', score: 0, note })

/**
 * Did `side` follow this check in a game? `at` is how many plies it took to
 * reach the opening. Returns { status: 'pass' | 'partial' | 'fail' | 'na', score, note };
 * 'na' means the advice never came up or the game ended before it could.
 */
export function evaluate(c, { moves, side, at }) {
  const mine = (i) => (i % 2 === 0) === (side === 'w')
  const label = (i) => {
    const n = Math.floor(i / 2) + 1
    return i % 2 === 0 ? `${n}.${moves[i]}` : `${n}...${moves[i]}`
  }
  /** First of your moves in [from, to] that matches, or -1. */
  const find = (match, from, to = moves.length - 1) => {
    for (let i = Math.max(0, from); i <= to && i < moves.length; i++) if (mine(i) && match(moves[i])) return i
    return -1
  }

  if (c.kind === 'order') {
    const a = find(c.first, at)
    const b = find(c.then, at)
    if (b >= 0 && (a < 0 || a > b)) return fail(`${label(b)} came first`)
    return a >= 0 ? pass(label(a)) : NA
  }

  // Where the window opens: straight after the opening, or after the trigger.
  let start = at
  let after = ''
  if (c.when) {
    const k = c.when.length
    const last = c.next ? at : moves.length - k
    let hit = -1
    for (let i = at; i <= last && i + k <= moves.length; i++) {
      if (!mine(i + k - 1) && c.when.every((m, n) => m(moves[i + n]))) {
        hit = i
        break
      }
    }
    if (hit < 0) return NA
    start = hit + k
    after = `after ${label(start - 1)} `
  }
  const firstOwn = mine(start) ? start : start + 1
  const end = c.by ? 2 * (c.by - 1) + (side === 'w' ? 0 : 1) : firstOwn + 2 * (c.within - 1)
  /** Your last move of the window was played, so the window can be judged in full. */
  const complete = moves.length > end
  const limit = c.by ? `by move ${c.by}` : c.within === 1 ? 'next move' : `within ${c.within} moves`

  if (c.kind === 'avoid') {
    const bad = find(c.move, start, end)
    if (bad >= 0) return fail(`${after}you played ${label(bad)}`)
    return (c.when ? moves.length > firstOwn : complete) ? pass() : NA
  }

  if (c.kind === 'play') {
    // Without a trigger the move may have come early, on the way to the opening.
    const done = find(c.move, c.when ? start : 0, end)
    if (done >= 0) return pass(label(done))
    if (c.when && find(c.move, 0, start - 1) >= 0) return pass('already played')
    if (!complete) return NA
    return fail(c.when && c.within === 1 ? `${after}you played ${label(firstOwn)}` : `${after}no ${c.move.text} ${limit}`)
  }

  // setup
  const missing = c.moves.filter((m) => find(m, 0, end) < 0)
  if (!missing.length) return pass()
  if (!complete) return NA
  const score = 1 - missing.length / c.moves.length
  return { status: score ? 'partial' : 'fail', score, note: `${after}no ${missing.map((m) => m.text).join(', ')} ${limit}` }
}

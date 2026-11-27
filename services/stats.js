// Pure functions: how a player's results in an opening change with the strength of the opponent.
import { ineligibleReason, reached, userResult, userSide } from './matcher.js'

/** An opponent this many points above or below the player is stronger or weaker; closer is about level. */
export const BAND = 100
/** The trend compares this many of the newest games with as many before them. */
export const TREND_WINDOW = 20
/** Struggling: at least this many games against stronger opponents, scoring below STRUGGLE_SCORE percent. */
export const STRUGGLE_MIN_GAMES = 8
export const STRUGGLE_SCORE = 35

/**
 * The games "Your record here" counts: eligible under the player's settings, played with the
 * opening's colour, and reaching it. Oldest first, as `games` is.
 */
function gamesHere(node, games, settings) {
  return games.filter((g) => userSide(g, settings) === node.side && !ineligibleReason(g, settings) && reached(node, g))
}

/** Wins plus half the draws, as a whole percentage of the games, or null with no games. */
function score({ games, win, draw }) {
  return games ? Math.round(((win + draw / 2) / games) * 100) : null
}

function tally(results) {
  const t = { games: results.length, win: 0, draw: 0, loss: 0 }
  for (const r of results) t[r]++
  return { ...t, score: score(t) }
}

/**
 * Results in this opening by how the opponent's rating compared with the player's, both as
 * recorded on the game. The two sites rate on different scales, but both numbers of a game
 * come from the same site, so the difference is fair. Returns { weaker, even, stronger },
 * each { games, win, draw, loss, score }, and `unrated`: how many games were left out
 * because a side had no rating, such as a game against the computer.
 */
export function ratingBands(node, games, settings) {
  const bands = { weaker: [], even: [], stronger: [] }
  let unrated = 0
  for (const g of gamesHere(node, games, settings)) {
    const [me, opp] = node.side === 'w' ? [g.white, g.black] : [g.black, g.white]
    if (!Number.isFinite(me.rating) || !Number.isFinite(opp.rating)) {
      unrated++
      continue
    }
    const diff = opp.rating - me.rating
    bands[diff < -BAND ? 'weaker' : diff > BAND ? 'stronger' : 'even'].push(userResult(g, node.side))
  }
  return { weaker: tally(bands.weaker), even: tally(bands.even), stronger: tally(bands.stronger), unrated }
}

/**
 * The score of the newest TREND_WINDOW games here beside the score of the TREND_WINDOW
 * before them, as { recent, before }, or null with fewer than two full windows.
 */
export function scoreTrend(node, games, settings) {
  const results = gamesHere(node, games, settings).map((g) => userResult(g, node.side))
  if (results.length < TREND_WINDOW * 2) return null
  return {
    recent: tally(results.slice(-TREND_WINDOW)).score,
    before: tally(results.slice(-TREND_WINDOW * 2, -TREND_WINDOW)).score,
  }
}

/** True when the player has met enough stronger opponents here to say so, and scores badly against them. */
export function struggling(bands) {
  return bands.stronger.games >= STRUGGLE_MIN_GAMES && bands.stronger.score < STRUGGLE_SCORE
}

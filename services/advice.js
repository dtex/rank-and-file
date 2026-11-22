// Advice accuracy: how well a game followed the study notes of the openings it
// reached, and the "follow the advice" missions that start when recent games
// fall short. Only openings you have uncovered are scored, and only games
// finished after you uncovered them, since before that you had not seen the notes.
import { evaluate } from './checks.js'
import { gameKeys, ineligibleReason, userSide } from './matcher.js'
import { DEFAULT_SETTINGS } from './store.js'

/** Games in the rolling average, and games an advice mission asks for. */
export const ADVICE_WINDOW = 4

/** Average accuracy (0 to 100) below which an advice mission starts. 0 switches them off. */
export const adviceThreshold = (settings) => settings.adviceThreshold ?? DEFAULT_SETTINGS.adviceThreshold

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const pct = (xs) => Math.round(mean(xs) * 100)

/**
 * Score a game against every uncovered opening it reached with the user's colour.
 * Returns null when nothing applied, else { score, openings: [{ id, score, checks }] }.
 * Each check is { idea, status, score, note }; `idea` indexes the opening's ideas.
 * An opening's score is null when none of its advice came up in the game.
 */
export function gameAdvice(tree, progress, game) {
  const { settings } = progress
  if (game.end <= progress.createdAt || !game.moves?.length) return null
  const side = userSide(game, settings.username)
  if (!side || ineligibleReason(game, settings)) return null
  const keys = gameKeys(game)
  const openings = []
  const all = []
  for (const node of tree.nodes) {
    const mission = progress.missions[node.id]
    if (!mission || mission.status === 'locked' || node.side !== side || game.end <= mission.startedAt) continue
    const at = keys.indexOf(node.key)
    if (at < 0) continue
    const checks = []
    node.advice.forEach((a, idea) => {
      if (a.check) checks.push({ idea, ...evaluate(a.check, { moves: game.moves, side, at }) })
    })
    const scores = checks.filter((c) => c.score !== null).map((c) => c.score)
    if (!checks.length) continue
    all.push(...scores)
    openings.push({ id: node.id, score: scores.length ? pct(scores) : null, checks })
  }
  if (!openings.length) return null
  return { score: all.length ? pct(all) : null, openings }
}

/** Games that reached `node` and were scored on its advice, oldest first: [{ game, score, checks }]. */
export function adviceHistory(tree, progress, games, node) {
  const out = []
  if (!progress.missions[node.id] || progress.missions[node.id].status === 'locked') return out
  for (const game of games) {
    const o = gameAdvice(tree, progress, game)?.openings.find((x) => x.id === node.id)
    if (o && o.score !== null) out.push({ game, score: o.score, checks: o.checks })
  }
  return out
}

export const average = (rows) => (rows.length ? Math.round(mean(rows.map((r) => r.score))) : null)

/** The games an active advice mission has collected so far, at most ADVICE_WINDOW. */
export function missionRows(history, mission) {
  return history.filter((h) => h.game.end > mission.since).slice(-ADVICE_WINDOW)
}

/**
 * Start and finish advice missions for games that have not been looked at yet.
 * A mission starts when the last four scored games in an opening average below
 * the threshold, and is done once four games played after that average at or
 * above it. It runs beside the opening missions and never blocks them.
 * Mutates `progress`; returns the events it added.
 */
export function updateAdviceMissions(tree, progress, games) {
  // The first time this runs, look only at where each opening stands today
  // rather than replaying missions that would have come and gone.
  const firstRun = !progress.advice
  const state = (progress.advice ??= { checkedTo: 0, missions: {} })
  const limit = adviceThreshold(progress.settings)
  const events = []
  const latest = games.reduce((t, g) => Math.max(t, g.end), 0)
  if (latest <= state.checkedTo) return events

  // Score each new game once, then group by opening.
  const byNode = new Map()
  for (const game of [...games].sort((a, b) => a.end - b.end)) {
    for (const o of gameAdvice(tree, progress, game)?.openings ?? []) {
      if (o.score === null) continue
      if (!byNode.has(o.id)) byNode.set(o.id, [])
      byNode.get(o.id).push({ game, score: o.score })
    }
  }

  for (const [id, history] of byNode) {
    history.forEach(({ game }, i) => {
      if (game.end <= state.checkedTo || (firstRun && i < history.length - 1)) return
      const soFar = history.slice(0, i + 1)
      const m = state.missions[id]
      let type = null
      let avg
      if (m?.status === 'active') {
        const rows = missionRows(soFar, m)
        avg = average(rows)
        if (rows.length === ADVICE_WINDOW && avg >= limit) {
          Object.assign(m, { status: 'done', completedAt: game.end, finalAverage: avg })
          type = 'advice_done'
        }
      } else {
        const rows = soFar.slice(-ADVICE_WINDOW)
        avg = average(rows)
        if (rows.length === ADVICE_WINDOW && avg < limit) {
          state.missions[id] = { status: 'active', since: game.end, average: avg, threshold: limit, rounds: (m?.rounds ?? 0) + 1 }
          type = 'advice_started'
        }
      }
      if (type) {
        const event = { id: `${type}-${id}-${game.end}`, type, node: id, average: avg, threshold: limit, at: game.end, seen: false }
        progress.events.push(event)
        events.push(event)
      }
    })
  }
  state.checkedTo = latest
  return events
}

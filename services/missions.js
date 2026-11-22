// Mission state: which openings are uncovered, which two are active, and what
// happens when a game counts. All functions mutate the `progress` object passed in.
import { judge, userSide } from './matcher.js'

/** Parked missions allowed per colour. Keeps "choose another branch" from uncovering the whole map. */
const MAX_PARKED = 1

/** Openings a user may have uncovered without a membership: the two starting ones and four more. */
export const FREE_OPENINGS = 6

/** Locked missions (see applyEntitlement) are back under the fog: kept, but not shown or played. */
export const isUncovered = (progress, id) => {
  const m = progress.missions[id]
  return !!m && m.status !== 'locked'
}

export const uncoveredCount = (progress) => Object.values(progress.missions).filter((m) => m.status !== 'locked').length

/** Whether one more opening may be uncovered under `limit`. */
export const canUncover = (progress, limit = Infinity) => uncoveredCount(progress) < limit

const paywall = (message) => Object.assign(new Error(message), { paywall: true })

function walk(node, visit) {
  visit(node)
  for (const c of node.children) walk(c, visit)
}

/**
 * Hidden openings for `side` that sit next to something already uncovered,
 * main lines first. These are the fog tiles on the map.
 */
export function candidates(tree, progress, side) {
  const out = []
  walk(tree.root, (n) => {
    if (n === tree.root || isUncovered(progress, n.id)) return
    const parentOpen = n.parent === tree.root.id || isUncovered(progress, n.parent)
    if (parentOpen && (!side || n.side === side)) out.push(n)
  })
  return out
}

function activate(progress, node, since) {
  const m = (progress.missions[node.id] ??= { status: 'active', side: node.side, startedAt: since, games: [] })
  m.status = 'active'
  m.since = since
  progress.slots[node.side] = node.id
  return m
}

/**
 * Give each empty slot the next opening in line, while `limit` allows another
 * to be uncovered. Returns the openings that were uncovered.
 */
export function fillSlots(tree, progress, since, limit = Infinity) {
  const started = []
  for (const side of ['w', 'b']) {
    if (progress.slots[side] || !canUncover(progress, limit)) continue
    const next = candidates(tree, progress, side).find((n) => !progress.missions[n.id])
    if (!next) continue
    activate(progress, next, since)
    started.push(next)
  }
  return started
}

/**
 * Judge games that have no verdict yet, oldest first, and advance missions.
 * Returns { judged, events } where judged are the games whose verdict was set.
 */
export function processGames(tree, progress, games, limit = Infinity) {
  const { settings } = progress
  const judged = []
  const events = []
  const pending = games.filter((g) => !g.verdict).sort((a, b) => a.end - b.end)

  for (const game of pending) {
    judged.push(game)
    const side = userSide(game, settings.username)
    if (!side) {
      game.verdict = { type: 'not_eligible', reason: `${settings.username} did not play in this game` }
      continue
    }
    if (game.end <= progress.createdAt) {
      game.verdict = { type: 'history' }
      continue
    }
    const id = progress.slots[side]
    const mission = id ? progress.missions[id] : null
    const node = id ? tree.byId.get(id) : null
    if (mission && game.end <= mission.since) {
      game.verdict = { type: 'before_mission', node: id }
      continue
    }
    const verdict = judge(game, { node, side, settings })
    if (verdict.type === 'counted') {
      mission.games.push(game.uuid)
      verdict.count = mission.games.length
      verdict.target = node.target
      if (mission.games.length >= node.target) {
        mission.status = 'done'
        mission.completedAt = game.end
        progress.slots[side] = null
        // The next mission starts from this game's end, so games later in the same sync can count for it.
        const [next] = fillSlots(tree, progress, game.end, limit)
        const event = { id: `${id}-${game.end}`, type: 'completed', node: id, next: next?.id ?? null, at: game.end, seen: false }
        // More to uncover, but the free openings are used up.
        if (!next && !canUncover(progress, limit) && candidates(tree, progress, side).length) event.paywall = true
        progress.events.push(event)
        events.push(event)
      }
    }
    game.verdict = verdict
  }
  return { judged, events }
}

/**
 * Switch a colour's mission to another opening: either a hidden neighbour
 * (which uncovers it) or a parked mission. The current mission is parked and keeps its count.
 */
export function switchMission(tree, progress, toId, now, limit = Infinity) {
  const node = tree.byId.get(toId)
  if (!node || node === tree.root) throw new Error('That opening is not on the map.')
  const side = node.side
  const existing = progress.missions[toId]
  if (existing?.status === 'done') throw new Error('That mission is already complete.')
  if (existing?.status === 'active') return node
  if (existing?.status === 'locked') throw paywall('That opening is locked. Subscribe to open it again, with its progress intact.')
  if (!existing && !canUncover(progress, limit)) {
    throw paywall(`You have uncovered all ${limit} free openings. Subscribe to uncover more.`)
  }
  if (!existing && !candidates(tree, progress, side).includes(node)) {
    throw new Error('That opening is not next to anything you have uncovered yet.')
  }

  const currentId = progress.slots[side]
  const parked = Object.values(progress.missions).filter((m) => m.side === side && m.status === 'parked').length
  const parkedAfter = parked + (currentId ? 1 : 0) - (existing ? 1 : 0)
  // Resuming never adds to the parked pile, so only a new opening is held back.
  if (!existing && parkedAfter > MAX_PARKED) {
    throw new Error('You already have a parked mission for this colour. Finish or resume it before uncovering another.')
  }
  if (currentId) progress.missions[currentId].status = 'parked'
  activate(progress, node, now)
  return node
}

/**
 * Bring the missions in line with the user's membership. Call before anything
 * reads or changes them.
 *
 * Without a membership only the first FREE_OPENINGS openings ever uncovered stay
 * open. The rest are locked: kept with their counts, but back under the fog and
 * out of play. A colour whose mission was locked falls back to a parked one.
 *
 * With a membership every locked mission comes back as it was. One that was
 * active takes its slot again, counting games from `now` on, so games played
 * while locked never count.
 *
 * Returns true when `progress` changed.
 */
export function applyEntitlement(tree, progress, subscribed, now) {
  const entries = Object.entries(progress.missions)
  let changed = false

  if (subscribed) {
    for (const [id, m] of entries) {
      if (m.status !== 'locked') continue
      const was = m.lockedFrom
      delete m.lockedFrom
      m.status = was === 'done' ? 'done' : 'parked'
      if (was !== 'done') m.since = now
      if (was === 'active' && tree.byId.has(id)) {
        const current = progress.slots[m.side]
        if (current && current !== id) progress.missions[current].status = 'parked'
        activate(progress, tree.byId.get(id), now)
      }
      changed = true
    }
    return changed
  }

  // A parent is always uncovered before its children, so the first six are a connected piece of the map.
  const free = new Set([...entries].sort((a, b) => a[1].startedAt - b[1].startedAt).slice(0, FREE_OPENINGS).map(([id]) => id))
  for (const [id, m] of entries) {
    if (free.has(id) || m.status === 'locked') continue
    m.lockedFrom = m.status
    m.status = 'locked'
    if (progress.slots[m.side] === id) progress.slots[m.side] = null
    changed = true
  }
  if (!canUncover(progress, FREE_OPENINGS)) {
    for (const side of ['w', 'b']) {
      if (progress.slots[side]) continue
      const parked = entries.filter(([id, m]) => m.side === side && m.status === 'parked' && tree.byId.has(id)).sort((a, b) => b[1].since - a[1].since)[0]
      if (!parked) continue
      activate(progress, tree.byId.get(parked[0]), now)
      changed = true
    }
  }
  return changed
}

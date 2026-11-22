import { loadState, locked } from '../services/engine.js'
import { switchMission } from '../services/missions.js'
import { gamesView, openingView, openingsView, stateView } from '../services/views.js'

export default async function missionRoutes(app) {
  app.get('/api/state', (req) => locked(req.cb.store, async () => {
    const { tree, progress, games } = await loadState(req.cb)
    return stateView(tree, progress, games, req.cb.plan)
  }))

  app.get('/api/games', (req) => locked(req.cb.store, async () => {
    const { tree, progress, games } = await loadState(req.cb)
    return gamesView(tree, progress, games)
  }))

  app.get('/api/openings', (req) => locked(req.cb.store, async () => {
    const { tree, progress } = await loadState(req.cb)
    return openingsView(tree, progress)
  }))

  app.get('/api/openings/:id', (req, reply) => locked(req.cb.store, async () => {
    const { tree, progress, games } = await loadState(req.cb)
    const view = openingView(tree, progress, games, req.params.id)
    if (!view && progress.missions[req.params.id]?.status === 'locked') {
      return reply.code(402).send({ error: 'That opening is locked. Subscribe to open it again, with its progress intact.', paywall: true })
    }
    return view ?? reply.code(404).send({ error: 'You have not uncovered that opening yet.' })
  }))

  // Body: { id } of a parked mission to resume. There is no way to choose a hidden opening.
  app.post('/api/missions/switch', (req, reply) => locked(req.cb.store, async () => {
    const { tree, progress, games } = await loadState(req.cb)
    const id = req.body?.id
    if (typeof id !== 'string') return reply.code(400).send({ error: 'Say which parked mission to resume.' })
    try {
      switchMission(tree, progress, id, Math.floor(Date.now() / 1000))
    } catch (err) {
      if (err.paywall) return reply.code(402).send({ error: err.message, paywall: true })
      return reply.code(409).send({ error: err.message })
    }
    await req.cb.store.saveProgress(progress)
    return stateView(tree, progress, games, req.cb.plan)
  }))

  app.post('/api/events/seen', (req) => locked(req.cb.store, async () => {
    const { tree, progress, games } = await loadState(req.cb)
    const ids = new Set(req.body?.ids || [])
    for (const e of progress.events) if (ids.has(e.id)) e.seen = true
    await req.cb.store.saveProgress(progress)
    return stateView(tree, progress, games, req.cb.plan)
  }))
}

import { runSync } from '../services/engine.js'

/** One sync per user at a time; a second click joins the one already running. */
const running = new Map()

export default async function syncRoutes(app) {
  app.post('/api/sync', async (req, reply) => {
    const { store, fetchImpl } = req.cb
    try {
      if (!running.has(store.userId)) {
        running.set(store.userId, runSync({ store, fetchImpl }).finally(() => running.delete(store.userId)))
      }
      return await running.get(store.userId)
    } catch (err) {
      req.log.error(err)
      return reply.code(502).send({ error: err.message })
    }
  })
}

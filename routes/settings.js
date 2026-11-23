import { adviceThreshold } from '../services/advice.js'
import { locked } from '../services/engine.js'
import { SITES, SITE_IDS, SITE_NAMES, usernamesOf } from '../services/sites.js'
import { planView } from '../services/views.js'

const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'daily']

export default async function settingsRoutes(app) {
  app.get('/api/settings', async (req) => {
    const p = await req.cb.store.loadProgress()
    return { settings: { ...p.settings, adviceThreshold: adviceThreshold(p.settings) }, timeClassOptions: TIME_CLASSES, lastSync: p.lastSync, plan: planView(req.cb.plan, p) }
  })

  app.put('/api/settings', (req, reply) => locked(req.cb.store, async () => {
    const { store } = req.cb
    const body = req.body || {}
    const usernames = usernamesOf(body)
    for (const id of SITE_IDS) {
      if (usernames[id] && !/^[A-Za-z0-9_-]{2,30}$/.test(usernames[id])) {
        return reply.code(400).send({ error: `That ${SITES[id].name} username does not look right: use letters, numbers, dashes or underscores.` })
      }
    }
    if (!SITE_IDS.some((id) => usernames[id])) {
      return reply.code(400).send({ error: `Enter your username on ${SITE_NAMES.replace(' and ', ' or ')}. One is enough.` })
    }
    const timeClasses = TIME_CLASSES.filter((t) => (body.timeClasses || []).includes(t))
    if (!timeClasses.length) return reply.code(400).send({ error: 'Tick at least one type of game to count.' })

    let p = await store.loadProgress()
    const previous = usernamesOf(p.settings)
    // Adding a site keeps everything: its games simply join in. Changing or removing an
    // account does not, because stored games and mission counts belong to the old one.
    if (SITE_IDS.some((id) => previous[id] && usernames[id].toLowerCase() !== previous[id].toLowerCase())) {
      if (body.reset !== true) {
        return reply.code(409).send({ error: 'Changing or removing a username starts over.', needsReset: true })
      }
      await store.reset()
      p = await store.loadProgress()
    }
    const wanted = Number(body.adviceThreshold ?? adviceThreshold(p.settings))
    if (!Number.isInteger(wanted) || wanted < 0 || wanted > 100) {
      return reply.code(400).send({ error: 'The advice accuracy target must be a whole number from 0 to 100.' })
    }
    p.settings = { usernames, timeClasses, ratedOnly: body.ratedOnly !== false, adviceThreshold: wanted }
    await store.saveProgress(p)
    return { settings: p.settings }
  }))
}

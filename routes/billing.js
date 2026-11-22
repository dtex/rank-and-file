export default async function billingRoutes(app) {
  const { billing } = app.ctx

  app.post('/api/billing/checkout', async (req) => ({ url: await billing.checkout(req.user, req.body?.plan, req.cb.plan) }))

  app.post('/api/billing/confirm', async (req) => ({ ok: await billing.confirm(req.user, req.body?.sessionId) }))

  app.post('/api/billing/portal', async (req) => ({ url: await billing.portal(req.user) }))
}

/** Stripe calls this, not a browser. It is trusted by its signature, which is checked against the exact bytes sent. */
export async function stripeWebhook(app) {
  const { billing } = app.ctx
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))

  app.post('/webhooks/stripe', async (req, reply) => {
    if (!billing.enabled) return reply.code(503).send({ error: 'Billing is not set up.' })
    let event
    try {
      event = billing.readEvent(req.body, req.headers['stripe-signature'])
    } catch {
      return reply.code(400).send({ error: 'The signature does not match.' })
    }
    await billing.handleEvent(event)
    return { received: true }
  })
}

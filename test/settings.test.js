import test from 'node:test'
import assert from 'node:assert/strict'
import { signIn, testApp, uniqueEmail } from './helpers/app.js'

const layoutOf = async (c) => (await c.get('/api/state')).json().openingsLayout

test('the openings layout is kept for each kind of device, and survives other settings', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx, uniqueEmail())
  assert.deepEqual(await layoutOf(c), { desktop: 'map', mobile: 'outline' }, 'the map on a desktop and the outline on a phone, to start with')

  const res = await c.put('/api/settings/layout', { device: 'desktop', layout: 'outline' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(await layoutOf(c), { desktop: 'outline', mobile: 'outline' }, 'the phone keeps its own')
  await c.put('/api/settings/layout', { device: 'mobile', layout: 'map' })
  assert.deepEqual(await layoutOf(c), { desktop: 'outline', mobile: 'map' })

  for (const body of [{ device: 'tablet', layout: 'map' }, { device: 'mobile', layout: 'grid' }, {}]) {
    assert.equal((await c.put('/api/settings/layout', body)).statusCode, 400, JSON.stringify(body))
  }
  assert.deepEqual(await layoutOf(c), { desktop: 'outline', mobile: 'map' }, 'a refused change changes nothing')

  // Saving the Settings form, which knows nothing of the layout, keeps it.
  const base = { timeClasses: ['blitz'], ratedOnly: true }
  assert.equal((await c.put('/api/settings', { ...base, usernames: { chesscom: 'me' }, adviceThreshold: 60 })).statusCode, 200)
  assert.deepEqual(await layoutOf(c), { desktop: 'outline', mobile: 'map' })

  // So does starting over with another account.
  assert.equal((await c.put('/api/settings', { ...base, usernames: { chesscom: 'someone' }, reset: true })).statusCode, 200)
  assert.deepEqual(await layoutOf(c), { desktop: 'outline', mobile: 'map' })
})

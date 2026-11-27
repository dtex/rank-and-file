import test from 'node:test'
import assert from 'node:assert/strict'
import { EARLY_PLACES, priceFor } from '../services/pricing.js'
import { setEarlyPlaces } from './helpers/db.js'
import { testApp } from './helpers/app.js'

test('the early price is $2 a month with no yearly plan, for holders and while places are left', () => {
  const early = { month: 2, year: null, early: true }
  const full = { month: 5, year: 40, early: false }
  assert.deepEqual(priceFor({ taken: 0, mine: false }), early)
  assert.deepEqual(priceFor({ taken: EARLY_PLACES - 1, mine: false }), early)
  assert.deepEqual(priceFor({ taken: EARLY_PLACES, mine: false }), full)
  assert.deepEqual(priceFor({ taken: EARLY_PLACES, mine: true }), early, 'a holder keeps the price')
  assert.deepEqual(priceFor({ taken: 0, mine: false }, true), full, 'a member at the full price is not offered it')
  assert.deepEqual(priceFor({ taken: EARLY_PLACES, mine: true }, true), early)
})

test('the pricing page shows the price a new subscriber would get', async (t) => {
  const { app, pool } = await testApp()
  t.after(() => setEarlyPlaces(pool, 100))
  await setEarlyPlaces(pool, 99)
  const early = (await app.inject({ url: '/pricing' })).body
  assert.match(early, /<h1>Free to start, \$2 a month for the whole map<\/h1>/)
  assert.match(early, /first 100 subscribers, yours for good\. After the first 100 subscribers it's \$5 a month or \$40 a year/)

  await setEarlyPlaces(pool, 100)
  const full = (await app.inject({ url: '/pricing' })).body
  assert.match(full, /<h1>Free to start, \$5 a month for the whole map<\/h1>/)
  assert.match(full, /Or \$40 a year, which is 4 months free/)
})

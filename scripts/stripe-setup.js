// Create the membership product and its two prices in Stripe, once per Stripe account:
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.js
// Prints the two lines to add to .env. Running it again finds the existing prices, and replaces
// one whose amount has changed here. A replaced price stays active for the members already on it.
import Stripe from 'stripe'

try {
  process.loadEnvFile()
} catch { /* no .env file */ }

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Set STRIPE_SECRET_KEY first.')
  process.exit(1)
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const PLANS = [
  { env: 'STRIPE_PRICE_MONTHLY', key: 'rank_and_file_monthly', amount: 500, interval: 'month' },
  { env: 'STRIPE_PRICE_YEARLY', key: 'rank_and_file_yearly', amount: 4000, interval: 'year' },
]

const existing = await stripe.prices.list({ lookup_keys: PLANS.map((p) => p.key), active: true })
let productId = existing.data[0]?.product
for (const plan of PLANS) {
  let price = existing.data.find((p) => p.lookup_key === plan.key)
  if (!price || price.unit_amount !== plan.amount) {
    productId ??= (await stripe.products.create({ name: 'Rank and File membership' })).id
    price = await stripe.prices.create({ product: productId, currency: 'usd', unit_amount: plan.amount, recurring: { interval: plan.interval }, lookup_key: plan.key, transfer_lookup_key: true })
  }
  console.log(`${plan.env}=${price.id}`)
}

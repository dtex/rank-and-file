// The user's plan: free, gifted or paying, with the way to subscribe or manage billing.
import { html, nothing } from 'lit'
import { View, api, longDay } from './lib.js'

const PRICE = { month: '$5 a month', year: '$50 a year' }

class CbPlan extends View {
  static properties = {
    plan: { attribute: false },
    /** Show the offer even when nothing is blocked yet (used in Settings). */
    full: { type: Boolean },
    busy: { state: true },
    error: { state: true },
  }

  /** Both billing calls answer with a Stripe page to go to. */
  async go(path, body) {
    this.busy = true
    this.error = ''
    try {
      const { url } = await api(path, { method: 'POST', body })
      location.assign(url)
    } catch (err) {
      this.error = err.message
      this.busy = false
    }
  }

  renderOffer(lead) {
    const p = this.plan
    return html`<p style="margin:6px 0 8px">${lead} Membership is ${PRICE.month} or ${PRICE.year}.</p>
      ${p.billing
        ? html`<div class="row">
            <button class="pri" ?disabled=${this.busy} @click=${() => this.go('/api/billing/checkout', { plan: 'monthly' })}>Subscribe monthly</button>
            <button ?disabled=${this.busy} @click=${() => this.go('/api/billing/checkout', { plan: 'yearly' })}>Subscribe yearly</button>
          </div>
          ${p.source === 'gift' ? html`<p class="muted" style="margin:8px 0 0">You will not be charged until your gift ends.</p>` : nothing}`
        : html`<p class="muted" style="margin:0">Membership is not on sale yet.</p>`}
      ${this.error ? html`<p style="color:var(--bad);margin:8px 0 0" role="alert">${this.error}</p>` : nothing}`
  }

  render() {
    const p = this.plan
    if (!p) return nothing
    if (p.source === 'subscription') {
      const ends = p.cancelAtPeriodEnd
      return html`<div class="mcard" style="margin:0">
        <span class="chip ${p.status === 'past_due' ? 'bad' : 'ok'}">Member</span>
        <p style="margin:6px 0 8px">${PRICE[p.interval] ?? 'Membership'}${p.until ? html`, ${ends ? 'ends' : 'renews'} ${longDay(p.until)}` : nothing}.
          ${p.status === 'past_due' ? html`<br><b>The last payment did not go through.</b> Update your card to keep your membership.` : nothing}</p>
        <button ?disabled=${this.busy} @click=${() => this.go('/api/billing/portal')}>Manage billing</button>
        ${this.error ? html`<p style="color:var(--bad);margin:8px 0 0" role="alert">${this.error}</p>` : nothing}
      </div>`
    }
    if (p.source === 'gift') {
      return html`<div class="mcard" style="margin:0">
        <span class="chip ok">Gifted membership</span>
        <p style="margin:6px 0 0">The whole map is open to you until ${longDay(p.until)}.</p>
        ${p.canSubscribe ? this.renderOffer('To carry on after that, subscribe now.') : nothing}
      </div>`
    }
    const blocked = p.atLimit || p.locked > 0
    return html`<div class="mcard ${blocked ? 'ask' : ''}" style="margin:0">
      <span class="chip">Free plan</span>
      <span class="muted"> ${p.uncovered} of ${p.freeOpenings} free openings uncovered</span>
      ${p.locked
        ? html`<p style="margin:6px 0 0"><b>${p.locked} opening${p.locked === 1 ? ' is' : 's are'} locked</b> since your membership ended.
            ${p.locked === 1 ? 'It comes' : 'They come'} back with ${p.locked === 1 ? 'its' : 'their'} progress when you subscribe again.</p>`
        : nothing}
      ${blocked || this.full ? this.renderOffer(p.atLimit ? 'A membership uncovers the rest of the map.' : `The first ${p.freeOpenings} openings are free; a membership uncovers the rest of the map.`) : nothing}
    </div>`
  }
}
customElements.define('cb-plan', CbPlan)

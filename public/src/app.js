import { html, nothing } from 'lit'
import { TAGLINE, View, api, ago, board, dot, sideName } from './lib.js'
import './map.js'
import './settings.js'
import './games.js'
import './opening.js'
import './account.js'

const TABS = [['map', 'Map'], ['games', 'Games'], ['openings', 'Openings'], ['settings', 'Settings']]
const SYNC_EVERY_MS = 5 * 60 * 1000

class CbApp extends View {
  static properties = {
    state: { state: true },
    route: { state: true },
    syncing: { state: true },
    notice: { state: true },
    fresh: { state: true },
    version: { state: true },
    me: { state: true },
    booted: { state: true },
  }

  constructor() {
    super()
    this.route = this.readRoute()
    this.fresh = new Set()
    this.version = 0
  }

  readRoute() {
    const h = location.hash.slice(1)
    if (h.startsWith('opening-')) return { name: 'opening', id: h.slice(8) }
    return { name: TABS.some(([t]) => t === h) ? h : 'map' }
  }

  async connectedCallback() {
    super.connectedCallback()
    // An emailed link arrives as #magic=<token>. Take it out of the address bar straight away.
    const magic = location.hash.match(/^#magic=([\w-]+)$/)
    const loginError = location.hash.match(/^#login-error=([\w-]+)$/)
    if (magic || loginError) history.replaceState(null, '', '/')
    this.magic = magic?.[1] ?? null
    this.loginError = loginError?.[1] ?? null

    window.addEventListener('hashchange', () => (this.route = this.readRoute()))
    window.addEventListener('cb-signed-out', () => { this.me = null; this.state = null })
    this.addEventListener('cb-me', () => this.loadMe())
    this.addEventListener('cb-state', (e) => this.setState(e.detail.state, e.detail.fresh))
    this.addEventListener('cb-reload', (e) => (e.detail?.sync ? this.sync() : this.load()))
    // Keep "synced 3 min ago" honest, and pick up new games while the tab stays open.
    setInterval(() => this.requestUpdate(), 30_000)
    setInterval(() => this.ready && document.visibilityState === 'visible' && this.sync({ quiet: true }), SYNC_EVERY_MS)
    if (!this.magic) await this.loadMe()
    this.booted = true
    this.afterCheckout()
  }

  /** Back from Stripe Checkout: confirm the payment so the membership shows at once. */
  async afterCheckout() {
    const q = new URLSearchParams(location.search)
    if (q.get('billing') !== 'success') return
    history.replaceState(null, '', `/${location.hash}`)
    if (!this.me) return
    try {
      await api('/api/billing/confirm', { method: 'POST', body: { sessionId: q.get('session_id') } })
      await this.loadMe()
      if (this.ready) await this.load()
      this.notice = { text: 'Thank you. Your membership is active and the whole map is open.' }
    } catch (err) {
      this.notice = { err: true, text: `Your payment went through, but the membership is not showing yet. Reload in a moment. ${err.message}` }
    }
  }

  /** Signed in, consented and with a chess.com username: the app itself can load. */
  get ready() {
    return !!this.me && !this.me.needsConsent && !!this.me.username
  }

  async loadMe() {
    const wasReady = this.ready
    try {
      this.me = await api('/api/me')
    } catch (err) {
      this.me = null
      if (err.status !== 401) this.notice = { err: true, text: `Could not reach Rank and File. ${err.message}` }
    }
    if (this.ready && !wasReady) {
      await this.load()
      this.sync({ quiet: true })
    }
  }

  setState(state, fresh = []) {
    this.state = state
    if (fresh.length) this.fresh = new Set(fresh)
    this.version++
  }

  async load() {
    try {
      this.setState(await api('/api/state'))
    } catch (err) {
      this.notice = { err: true, text: `Could not load your progress. ${err.message}` }
    }
  }

  async sync({ quiet = false } = {}) {
    if (this.syncing) return
    this.syncing = true
    try {
      const before = new Set(this.state?.nodes.map((n) => n.id))
      const r = await api('/api/sync', { method: 'POST' })
      const state = await api('/api/state')
      this.setState(state, this.state ? state.nodes.filter((n) => !before.has(n.id)).map((n) => n.id) : [])
      if (r.added) {
        this.notice = { text: `${r.added} new game${r.added === 1 ? '' : 's'}, ${r.counted} counted toward a mission.` }
      } else if (!quiet) {
        this.notice = { text: 'No new games since the last sync.' }
      }
    } catch (err) {
      this.notice = { err: true, text: `Sync failed. ${err.message}` }
    } finally {
      this.syncing = false
    }
  }

  async dismissEvent(event, to = 'map') {
    try {
      this.setState(await api('/api/events/seen', { method: 'POST', body: { ids: [event.id] } }))
    } catch (err) {
      this.notice = { err: true, text: err.message }
    }
    location.hash = to
  }

  /** An advice mission starting or finishing. */
  renderAdviceEvent(event) {
    const { node } = event
    const started = event.type === 'advice_started'
    return html`<div class="overlay" role="dialog" aria-modal="true" aria-label=${started ? 'New advice mission' : 'Advice mission complete'}>
      <div class="rcard">
        ${board(node.fen, node.side === 'b')}
        <div>
          <span class="chip ${started ? 'gold' : 'ok'}">${dot(node.side)}${started ? 'New advice mission' : 'Advice mission complete'}</span>
          <h3>${node.name}</h3>
          ${started
            ? html`<p style="margin-top:12px">Your last ${event.of} games that reached this opening followed its advice ${event.average}% of the time.
                  The target is ${event.threshold}%.</p>
                ${event.missed.length
                  ? html`<p class="muted" style="margin-bottom:4px">What slipped:</p>
                      <ul style="margin:0 0 12px;padding-left:20px">${event.missed.map((i) => html`<li>${i.text} <span class="muted">followed ${i.followed} of ${i.of}</span></li>`)}</ul>`
                  : nothing}
                <p class="muted">Mission: average ${event.threshold}% or better over your next ${event.of} games here. Your opening missions carry on as usual.</p>`
            : html`<p style="margin-top:12px">Your last ${event.of} games here averaged ${event.average}%, above the ${event.threshold}% target.</p>`}
          <div class="row">
            <button class="pri" @click=${() => this.dismissEvent(event)}>Back to the map</button>
            <button @click=${() => this.dismissEvent(event, `opening-${node.id}`)}>${started ? 'Study it' : 'See the games'}</button>
          </div>
        </div>
      </div>
    </div>`
  }

  /** Shown once for each completed mission, oldest first. */
  renderComplete(event) {
    if (event.type !== 'completed') return this.renderAdviceEvent(event)
    const { node, next } = event
    const reach = next?.reach
    const odds = !reach?.of ? ''
      : reach.reached === 0 ? `None of your last ${reach.of} ${sideName(next.side)} games got here, so this one may take a while.`
      : `From your history, about 1 in ${Math.max(1, Math.round(reach.of / reach.reached))} ${sideName(next.side)} games gets here.`
    return html`<div class="overlay" role="dialog" aria-modal="true" aria-label="Mission complete">
      <div class="rcard">
        ${board((next ?? node).fen, (next ?? node).side === 'b')}
        <div>
          <span class="chip ok">${node.name} complete · ${node.count} of ${node.target}</span>
          ${next
            ? html`<div class="eyebrow" style="margin-top:16px">New opening uncovered</div>
                <h3>${next.name}</h3>
                <div class="mv">${next.moves}</div>
                <p style="margin-top:12px">${next.blurb}</p>
                <p class="muted">${dot(next.side)}${next.isActive ? 'Your new mission' : 'Mission'}: reach this position ${next.target} times as ${sideName(next.side)}. ${odds}</p>
                <div class="row">
                  <button class="pri" @click=${() => this.dismissEvent(event)}>Back to the map</button>
                  <button @click=${() => this.dismissEvent(event, `opening-${next.id}`)}>Study it</button>
                </div>
                <p class="muted" style="margin-top:12px">It was chosen because, of the hidden ${sideName(next.side)} openings next to your map, it is the one your recent games reach most.</p>`
            : event.paywall
              ? html`<h3 style="margin-top:16px">That was your last free opening</h3>
                <p>You have uncovered all ${this.state.plan.freeOpenings} free openings, and they stay yours to play. A membership uncovers the rest of the map.</p>
                <button class="pri" @click=${() => this.dismissEvent(event)}>Back to the map</button>`
            : html`<h3 style="margin-top:16px">Nothing left to uncover from here</h3>
                <p>There are no more hidden ${sideName(node.side)} openings next to your map. More open up as your ${sideName(node.side === 'w' ? 'b' : 'w')} missions progress.</p>
                <button class="pri" @click=${() => this.dismissEvent(event)}>Back to the map</button>`}
        </div>
      </div>
    </div>`
  }

  renderView() {
    if (!this.state) return html`<div class="page"><p class="muted">Loading…</p></div>`
    switch (this.route.name) {
      case 'settings':
        return html`<cb-settings .me=${this.me}></cb-settings>`
      case 'games':
        return html`<cb-games .version=${this.version}></cb-games>`
      case 'openings':
        return html`<cb-openings .version=${this.version}></cb-openings>`
      case 'opening':
        return html`<cb-opening .openingId=${this.route.id} .version=${this.version}></cb-opening>`
      default:
        return html`<cb-map .state=${this.state} .fresh=${this.fresh}></cb-map>`
    }
  }

  render() {
    if (this.magic) return html`<cb-magic .token=${this.magic}></cb-magic>`
    if (!this.booted) return html`<div class="page"><p class="muted">Loading…</p></div>`
    if (!this.me) return html`<cb-login .error=${this.loginError}></cb-login>`
    if (this.me.needsConsent) return html`<cb-consent .me=${this.me}></cb-consent>`
    if (!this.me.username) return html`<cb-welcome></cb-welcome>`
    const tab = this.route.name === 'opening' ? 'openings' : this.route.name
    return html`
      <header class="bar">
        <a class="brand" href="#map" title=${TAGLINE}>Rank and File</a>
        <nav class="tabs">${TABS.map(([id, label]) => html`<a class="tab ${tab === id ? 'on' : ''}" href="#${id}">${label}</a>`)}</nav>
        <span class="sp"></span>
        ${this.state ? html`<span class="muted">${this.state.username} · synced ${ago(this.state.lastSync)}</span>` : nothing}
        <button ?disabled=${this.syncing} @click=${() => this.sync()}>${this.syncing ? 'Checking…' : 'Check for new games'}</button>
      </header>
      ${this.notice
        ? html`<div class="notice ${this.notice.err ? 'err' : ''}" role="status"><span>${this.notice.text}</span><span class="sp"></span>
            <button class="link" @click=${() => (this.notice = null)}>Dismiss</button></div>`
        : nothing}
      ${this.renderView()}
      ${this.state?.events.length ? this.renderComplete(this.state.events[0]) : nothing}`
  }
}
customElements.define('cb-app', CbApp)

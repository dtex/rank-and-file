import { html, nothing } from 'lit'
import { View, api, ago, board, dot, sideName } from './lib.js'
import './map.js'
import './settings.js'
import './games.js'
import './opening.js'

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
    saving: { state: true },
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
    window.addEventListener('hashchange', () => (this.route = this.readRoute()))
    this.addEventListener('cb-state', (e) => this.setState(e.detail.state, e.detail.fresh))
    this.addEventListener('cb-reload', (e) => (e.detail?.sync ? this.sync() : this.load()))
    // Keep "synced 3 min ago" honest, and pick up new games while the tab stays open.
    setInterval(() => this.requestUpdate(), 30_000)
    setInterval(() => document.visibilityState === 'visible' && this.sync({ quiet: true }), SYNC_EVERY_MS)
    await this.load()
    this.sync({ quiet: true })
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

  async save() {
    this.saving = true
    try {
      const r = await api('/api/save', { method: 'POST' })
      this.notice = { err: !r.pushed, text: r.message }
    } catch (err) {
      this.notice = { err: true, text: `Save failed. ${err.message}` }
    } finally {
      this.saving = false
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
                <p class="muted" style="margin-top:12px">Prefer another branch? Pick any hidden ${sideName(next.side)} tile on the map. ${next.name} is then parked and keeps its count.</p>`
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
        return html`<cb-settings></cb-settings>`
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
    const tab = this.route.name === 'opening' ? 'openings' : this.route.name
    return html`
      <header class="bar">
        <a class="brand" href="#map">Chess Buddy</a>
        <nav class="tabs">${TABS.map(([id, label]) => html`<a class="tab ${tab === id ? 'on' : ''}" href="#${id}">${label}</a>`)}</nav>
        <span class="sp"></span>
        ${this.state ? html`<span class="muted">${this.state.username} · synced ${ago(this.state.lastSync)}</span>` : nothing}
        <button ?disabled=${this.syncing} @click=${() => this.sync()}>${this.syncing ? 'Checking…' : 'Check for new games'}</button>
        <button ?disabled=${this.saving} @click=${() => this.save()}>${this.saving ? 'Saving…' : 'Save to GitHub'}</button>
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

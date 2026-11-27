// The Openings screen: every uncovered opening, as a map or as an outline, beside the
// missions sidebar. Which layout shows is saved on the account for each kind of device,
// so a phone can keep the outline while a laptop keeps the map.
import { html, nothing } from 'lit'
import './map.js'
import './plan.js'
import { View, accuracy, api, pips, resultVerb, sideName, verdict } from './lib.js'

/** Screens this wide or narrower count as mobile. Matches the phone layout in app.css. */
const MOBILE = window.matchMedia('(max-width: 860px)')
const deviceType = () => (MOBILE.matches ? 'mobile' : 'desktop')

const LAYOUTS = [['map', 'Map'], ['outline', 'Outline']]

/** The uncovered openings as a tree under the starting position, with the fog hanging off its parents. */
function buildTree(state) {
  const items = new Map(state.nodes.map((n) => [n.id, { id: n.id, node: n, kids: [] }]))
  for (const n of state.nodes) if (n.parent) items.get(n.parent)?.kids.push(items.get(n.id))
  for (const f of state.fog) items.get(f.parent)?.kids.push({ id: `fog-${f.fid}`, fog: f, kids: [] })
  return { root: items.get('start'), items }
}

/** The openings that lead to each of `ids`, so opening those shows every one of them. */
function ancestorsOf(state, ids) {
  const byId = new Map(state.nodes.map((n) => [n.id, n]))
  const out = new Set()
  for (const id of ids) {
    for (let n = byId.get(byId.get(id)?.parent); n && n.id !== 'start'; n = byId.get(n.parent)) out.add(n.id)
  }
  return out
}

const STATUS_WORD = { active: 'Active mission', parked: 'Parked', done: 'Complete' }

class CbOutline extends View {
  static properties = {
    state: { attribute: false },
    fresh: { attribute: false },
    open: { state: true },
  }

  willUpdate(changed) {
    if (!this.state) return
    if (!this.open) {
      // Start with the way to each active and parked mission showing, and everything else folded.
      const missions = this.state.nodes.filter((n) => n.status === 'active' || n.status === 'parked').map((n) => n.id)
      this.open = ancestorsOf(this.state, missions)
    }
    // A newly uncovered opening is shown, whatever was folded.
    if (changed.has('fresh') && this.fresh?.size) this.open = new Set([...this.open, ...ancestorsOf(this.state, this.fresh)])
  }

  toggle(id) {
    const open = new Set(this.open)
    open.has(id) ? open.delete(id) : open.add(id)
    this.open = open
  }

  /** Unfold or fold every opening that has something under it. */
  setAll(on) {
    this.open = on ? new Set(this.state.nodes.filter((n) => n.id !== 'start').map((n) => n.id)) : new Set()
  }

  renderItem(it) {
    if (it.fog) {
      const f = it.fog
      const label = html`<b class=${f.side}>?</b><span>${sideName(f.side)} line, unexplored</span>`
      // Only an admin's rows carry an id: they open the study page without uncovering anything.
      return html`<li class="ofog"><span class="twist" aria-hidden="true"></span>${f.id
        ? html`<a href="#opening-${f.id}" title="View this hidden opening's page">${label}</a>`
        : html`<span title="Finishing a mission uncovers the hidden opening that is most popular on chess.com.">${label}</span>`}</li>`
    }
    const n = it.node
    const open = this.open.has(n.id)
    const word = STATUS_WORD[n.status] ?? n.status
    return html`<li>
      <div class="orow ${n.status} ${this.fresh?.has(n.id) ? 'fresh' : ''}">
        ${it.kids.length
          ? html`<button class="twist" aria-expanded=${open ? 'true' : 'false'} aria-label="${open ? 'Hide' : 'Show'} what comes after ${n.name}"
              @click=${() => this.toggle(n.id)}>${open ? '▾' : '▸'}</button>`
          : html`<span class="twist" aria-hidden="true"></span>`}
        <a class="oname" href="#opening-${n.id}">
          <span class="dot ${n.side}" title=${sideName(n.side)}></span><b class="mvn">${n.lastMove}</b>
          <span class="nm">${n.name}</span>
          ${n.moves === n.lastMove ? nothing : html`<span class="mv">${n.moves}</span>`}
        </a>
        <span class="ost">${n.struggling
            ? html`<span class="caps vs" title="${n.struggling.games} games against stronger opponents, scoring ${n.struggling.score}%">${n.struggling.score}% v stronger</span>`
            : nothing}${n.adviceMission ? html`<span class="flag" title="Advice mission: follow this opening's ideas more closely">!</span>` : nothing}
          <span class="caps">${word}</span>${n.status === 'done' ? nothing : pips(n.count, n.target)}</span>
      </div>
      ${open && it.kids.length ? html`<ul>${it.kids.map((k) => this.renderItem(k))}</ul>` : nothing}
    </li>`
  }

  render() {
    if (!this.open) return nothing
    const { root } = buildTree(this.state)
    return html`
      <div class="otools">
        <button class="link" @click=${() => this.setAll(true)}>Unfold all</button>
        <button class="link" @click=${() => this.setAll(false)}>Fold all</button>
      </div>
      <ul class="outline">${root.kids.map((k) => this.renderItem(k))}</ul>`
  }
}
customElements.define('cb-outline', CbOutline)

class CbOpenings extends View {
  static properties = {
    state: { attribute: false },
    fresh: { attribute: false },
    device: { state: true },
    chosen: { state: true },
    error: { state: true },
    busy: { state: true },
  }

  constructor() {
    super()
    this.device = deviceType()
    this.onDevice = () => (this.device = deviceType())
  }

  connectedCallback() {
    super.connectedCallback()
    // Turning a tablet or resizing a window across the line switches to that kind of device's layout.
    MOBILE.addEventListener('change', this.onDevice)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    MOBILE.removeEventListener('change', this.onDevice)
  }

  /** The layout for this kind of device: a choice made here, else the one saved on the account. */
  get layout() {
    return this.chosen?.[this.device] ?? this.state.openingsLayout[this.device]
  }

  async choose(layout) {
    if (layout === this.layout) return
    const device = this.device
    // Switch at once; saving happens behind it.
    this.chosen = { ...this.chosen, [device]: layout }
    try {
      await api('/api/settings/layout', { method: 'PUT', body: { device, layout } })
    } catch (err) {
      this.error = `That layout is showing, but it could not be saved for next time. ${err.message}`
    }
  }

  async switchTo(body) {
    this.busy = true
    this.error = ''
    try {
      const before = new Set(this.state.nodes.map((n) => n.id))
      const state = await api('/api/missions/switch', { method: 'POST', body })
      const fresh = state.nodes.filter((n) => !before.has(n.id)).map((n) => n.id)
      this.dispatchEvent(new CustomEvent('cb-state', { detail: { state, fresh }, bubbles: true }))
    } catch (err) {
      this.error = err.message
    } finally {
      this.busy = false
    }
  }

  renderMission(side) {
    const { active, parked } = this.state.missions[side]
    return html`
      ${active
        ? html`<a class="as" href="#opening-${active.id}">
            <span class="caps who">As ${sideName(side)}</span>
            <h4>${active.name}</h4><span class="mv">${active.moves}</span>
            <span class="ct"><b>${active.count}<small>/${active.target}</small></b>${pips(active.count, active.target)}</span>
            ${active.reach.of ? html`<span class="note">Reached in ${active.reach.reached} of your last ${active.reach.of} ${sideName(side)} games.</span>` : nothing}
          </a>`
        : html`<p class="as"><span class="caps who">As ${sideName(side)}</span>${this.state.plan.atLimit
            ? `Your next ${sideName(side)} opening needs a membership.`
            : `No ${sideName(side)} openings left to uncover from here.`}</p>`}
      ${parked.map((p) => html`<div class="row" style="margin:-6px 0 14px">
        <span class="fine">Parked: ${p.name}, ${p.count} of ${p.target}</span>
        <button class="link" ?disabled=${this.busy} @click=${() => this.switchTo({ id: p.id })}>Resume</button></div>`)}`
  }

  /** "Follow the advice" missions, started when recent games in an opening fall below the target. */
  renderAdvice() {
    const list = this.state.missions.advice
    if (!list.length) return nothing
    return html`<div>
      <h3>Advice missions</h3>
      ${list.map((m) => html`<a class="as" href="#opening-${m.id}">
        <span class="caps who">Follow the advice · as ${sideName(m.side)}</span>
        <h4>${m.name}</h4>
        <span class="ct"><b>${m.current}<small>%</small></b></span>
        <span class="note">The average of your last ${m.of} games here. Bring it back up to ${m.threshold}%.</span>
      </a>`)}
    </div>`
  }

  renderSidebar() {
    const s = this.state
    return html`<aside class="sidebar">
      ${s.plan.subscribed ? nothing : html`<cb-plan .plan=${s.plan}></cb-plan>`}
      <div>
        <h3>Active missions</h3>
        ${this.renderMission('w')}${this.renderMission('b')}
      </div>
      ${this.renderAdvice()}
      <div>
        <h3>Latest results</h3>
        ${s.latest.length
          ? html`${s.latest.map((g) => html`<div class="res">
              <b>${resultVerb[g.result]}</b> as ${sideName(g.side)}, ${g.opening?.hidden ? html`<span class="hid">in a line not yet uncovered</span>`
                : g.opening ? g.opening.name : 'off the map'}.
              <span>${verdict(g.verdict, { short: true })}${g.advice?.score != null ? html` · advice ${accuracy(g.advice.score, s.adviceThreshold)}` : nothing}</span></div>`)}
            <p style="margin-top:12px"><a class="caps" href="#games">All games</a></p>`
          : html`<p class="fine">Nothing yet. Games you finish from now on show up here after a sync.</p>`}
      </div>
      <div class="fine">${s.totals.uncovered} of ${s.totals.openings} openings uncovered, ${s.totals.done} complete.<br>
        <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></div>
    </aside>`
  }

  render() {
    const layout = this.layout
    return html`
      <div class="omain ${layout}">
        <div class="viewbar">
          <div class="seg" role="group" aria-label="Show the openings as">
            ${LAYOUTS.map(([id, label]) => html`<button aria-pressed=${layout === id ? 'true' : 'false'} @click=${() => this.choose(id)}>${label}</button>`)}
          </div>
          ${this.error ? html`<span class="fine" style="color:var(--bad)">${this.error}</span>` : nothing}
        </div>
        ${layout === 'outline'
          ? html`<div class="oscroll"><cb-outline .state=${this.state} .fresh=${this.fresh}></cb-outline></div>`
          : html`<cb-map .state=${this.state} .fresh=${this.fresh}></cb-map>`}
      </div>
      ${this.renderSidebar()}`
  }
}
customElements.define('cb-openings', CbOpenings)

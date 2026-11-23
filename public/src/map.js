import { html, nothing, svg } from 'lit'
import './plan.js'
import { View, accuracy, api, board, pips, resultVerb, sideName, tile, verdict } from './lib.js'

const W = 150
const H = 200
const FOG_H = 34
const GAP_X = 56
const GAP_Y = 12
/** The diagram inside a tile, which the connecting lines run between. */
const BOARD = 104
const BOARD_MID = 58

/** Left-to-right tree: each parent is centred on its children. */
function layout(state) {
  const items = new Map()
  for (const n of state.nodes) items.set(n.id, { id: n.id, node: n, h: H, kids: [] })
  for (const n of state.nodes) if (n.parent) items.get(n.parent)?.kids.push(items.get(n.id))
  for (const f of state.fog) items.get(f.parent)?.kids.push({ id: `fog-${f.fid}`, fog: f, h: FOG_H, kids: [] })

  const root = items.get('start')
  const measure = (it) => {
    const kids = it.kids.reduce((sum, k) => sum + measure(k), 0) + GAP_Y * Math.max(0, it.kids.length - 1)
    it.kidsH = kids
    return (it.sub = Math.max(it.h, kids))
  }
  const all = []
  const edges = []
  const place = (it, depth, top) => {
    it.x = depth * (W + GAP_X)
    let y = top + (it.sub - it.kidsH) / 2
    for (const k of it.kids) {
      place(k, depth + 1, y)
      y += k.sub + GAP_Y
    }
    if (it.kids.length) {
      const first = it.kids[0]
      const last = it.kids.at(-1)
      it.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - it.h / 2
    } else {
      it.y = top + (it.sub - it.h) / 2
    }
    all.push(it)
    for (const k of it.kids) edges.push({ from: it, to: k })
  }
  measure(root)
  place(root, 0, 0)
  return { all, edges, width: Math.max(...all.map((i) => i.x)) + W, height: root.sub }
}

class CbMap extends View {
  static properties = {
    state: { attribute: false },
    fresh: { attribute: false },
    view: { state: true },
    error: { state: true },
    busy: { state: true },
  }

  constructor() {
    super()
    this.view = null
    this.fresh = new Set()
  }

  firstUpdated() {
    const vp = this.querySelector('.viewport')
    vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
    this.resize = new ResizeObserver(() => {
      if (!this.view) this.fit()
    })
    this.resize.observe(vp)
    this.fit()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.resize?.disconnect()
  }

  /** Show the whole map when it fits at a readable size; otherwise centre on the active missions. */
  fit() {
    const vp = this.querySelector('.viewport')
    if (!vp || !this.state || !vp.clientWidth) return
    const { all, width, height } = layout(this.state)
    const pad = 28
    const top = 56 // clears the zoom buttons
    const vw = vp.clientWidth
    const vh = vp.clientHeight
    const k = Math.min(1, Math.max(0.7, Math.min((vw - pad * 2) / width, (vh - top - pad) / height)))
    const focus = all.filter((i) => i.node?.status === 'active')
    const box = focus.length ? focus : all
    const cx = (Math.min(...box.map((i) => i.x)) + Math.max(...box.map((i) => i.x + W))) / 2
    const cy = (Math.min(...box.map((i) => i.y)) + Math.max(...box.map((i) => i.y + i.h))) / 2
    const place = (size, view, centre, lead, trail) =>
      size * k <= view - lead - trail
        ? lead + (view - lead - trail - size * k) / 2
        : Math.min(lead, Math.max(view - trail - size * k, view / 2 - centre * k))
    this.view = { k, x: place(width, vw, cx, pad, pad), y: place(height, vh, cy, top, pad) }
  }

  zoom(factor, cx, cy) {
    const vp = this.querySelector('.viewport')
    const v = this.view ?? { k: 1, x: 0, y: 0 }
    cx ??= vp.clientWidth / 2
    cy ??= vp.clientHeight / 2
    const k = Math.min(1.6, Math.max(0.3, v.k * factor))
    this.view = { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
  }

  onWheel(e) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
    else this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY }
  }

  onDown(e) {
    if (e.button !== 0) return
    this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, moved: false }
  }

  onMove(e) {
    const d = this.drag
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    if (!d.moved) {
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.classList.add('dragging')
    }
    this.view = { ...this.view, x: d.vx + dx, y: d.vy + dy }
  }

  onUp(e) {
    if (this.drag?.moved) {
      e.currentTarget.classList.remove('dragging')
      // The click that ends a drag should not open a node.
      this.suppressClick = true
      setTimeout(() => (this.suppressClick = false))
    }
    this.drag = null
  }

  onClickCapture(e) {
    if (this.suppressClick) {
      e.preventDefault()
      e.stopPropagation()
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

  renderNode(it) {
    const style = `left:${it.x}px;top:${it.y}px`
    if (it.fog) {
      const f = it.fog
      const label = html`<b class=${f.side}>?</b>${sideName(f.side)} line, unexplored`
      // Only an admin's tiles carry an id: they open the study page without uncovering anything.
      if (f.id) return html`<a class="fogn" style=${style} href="#opening-${f.id}" draggable="false" title="View this hidden opening's page">${label}</a>`
      return html`<div class="fogn" style=${style} title="Finishing a mission uncovers the hidden opening your games reach most.">${label}</div>`
    }
    const n = it.node
    if (n.status === 'start') return html`<div class="node start" style=${style}>${board(n.fen)}<span class="nm">The starting position</span></div>`
    return tile(n, { fresh: this.fresh?.has(n.id), style })
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
        <button class="link" ?disabled=${this.busy} @click=${() => this.switchTo({ id: p.id })}>Resume</button></div>`)}
      ${this.error && parked.length ? html`<p style="color:var(--bad)">${this.error}</p>` : nothing}`
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
        <span class="ct">${m.played ? html`<b>${m.current}<small>%</small></b>` : nothing}${pips(m.played, m.of)}</span>
        <span class="note">Your last ${m.of} games here averaged ${m.startAverage}%. Average ${m.threshold}% over ${m.of} new ones.</span>
      </a>`)}
    </div>`
  }

  render() {
    const s = this.state
    const { all, edges, width, height } = layout(s)
    const v = this.view ?? { k: 1, x: 28, y: 28 }
    return html`
      <div class="viewport" @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp}
        @pointercancel=${this.onUp} @click=${{ handleEvent: (e) => this.onClickCapture(e), capture: true }}>
        <div class="tools" @pointerdown=${(e) => e.stopPropagation()}>
          <button @click=${() => this.fit()}>Fit</button>
          <button aria-label="Zoom in" @click=${() => this.zoom(1.25)}>+</button>
          <button aria-label="Zoom out" @click=${() => this.zoom(0.8)}>−</button>
        </div>
        <div class="canvas" style="width:${width}px;height:${height}px;transform:translate(${v.x}px,${v.y}px) scale(${v.k})">
          <svg width=${width} height=${height} aria-hidden="true">${edges.map(({ from, to }) => {
            // Lines run from diagram to diagram, not from the edges of the tiles.
            const mid = (it) => it.y + (it.node && it.node.status !== 'start' ? BOARD_MID : it.h / 2 - (it.node ? 12 : 0))
            const x1 = from.x + (W + BOARD) / 2 + 10, y1 = mid(from), x2 = to.x + (to.fog ? 4 : (W - BOARD) / 2 - 10), y2 = mid(to), m = (x1 + x2) / 2
            return svg`<path d="M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}" fill="none"
              stroke=${to.fog ? 'var(--muted)' : 'var(--ink)'} stroke-width="1"
              stroke-dasharray=${to.fog ? '1 4' : nothing} stroke-linecap="round" />`
          })}</svg>
          ${all.map((it) => this.renderNode(it))}
        </div>
      </div>
      <aside class="sidebar">
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
}
customElements.define('cb-map', CbMap)

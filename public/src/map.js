// The openings as a map: a tree of diagrams to drag and zoom. One of the two layouts of the Openings screen (openings.js).
import { html, nothing, svg } from 'lit'
import { View, board, sideName, tile } from './lib.js'

/** How long a zoom from the buttons takes; matches .canvas.glide in app.css. */
const GLIDE_MS = 280
const W = 150
const H = 200
const FOG_H = 34
const GAP_X = 56
const GAP_Y = 12
/** The diagram inside a tile, which the connecting lines run between. */
const BOARD = 104
const BOARD_MID = 58
/** Half the width a skipped-move marker keeps clear of the connecting lines. */
const VIA_HALF = 24

/** A closed-off book: a move that is played on the way but is not an opening of its own. */
const NOT_BOOK = html`<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
  <path d="M14 7C11 5 7 5 3 6.5V22c4-1.5 8-1.5 11 .5 3-2 7-2 11-.5V6.5C21 5 17 5 14 7zM14 7v15.5" />
  <path d="M5 25.5 23 2.5" stroke="var(--bg)" stroke-width="4.5" /><path d="M5 25.5 23 2.5" />
</svg>`

/** Left-to-right tree: each parent is centred on its children. */
function layout(state) {
  const items = new Map()
  for (const n of state.nodes) items.set(n.id, { id: n.id, node: n, h: H, kids: [] })
  for (const n of state.nodes) {
    if (!n.parent) continue
    // A move on the way that is no opening of its own gets a marker in its own column, so each column is one turn.
    let kid = items.get(n.id)
    for (const move of [...(n.via ?? [])].reverse()) kid = { id: `via-${n.id}-${move}`, via: move, h: H, kids: [kid] }
    items.get(n.parent)?.kids.push(kid)
  }
  for (const f of state.fog) {
    // Under the fog the skipped moves stay unnamed, but still hold their columns.
    let kid = { id: `fog-${f.fid}`, fog: f, h: FOG_H, kids: [] }
    for (let i = f.skip ?? 0; i > 0; i--) kid = { id: `via-${f.fid}-${i}`, via: true, faint: true, h: FOG_H, kids: [kid] }
    items.get(f.parent)?.kids.push(kid)
  }

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

  /** Let the next change of view glide. Only the buttons use it: dragging and the wheel already move in small steps. */
  glide() {
    const canvas = this.querySelector('.canvas')
    if (!canvas) return
    canvas.classList.add('glide')
    clearTimeout(this.gliding)
    this.gliding = setTimeout(() => canvas.classList.remove('glide'), GLIDE_MS + 50)
  }

  /** Stop a glide the moment the user takes hold of the map. */
  settle() {
    clearTimeout(this.gliding)
    this.querySelector('.canvas')?.classList.remove('glide')
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
    this.settle()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
    else this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY }
  }

  onDown(e) {
    if (e.button !== 0) return
    this.settle()
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

  renderNode(it) {
    const style = `left:${it.x}px;top:${it.y}px`
    if (it.fog) {
      const f = it.fog
      const label = html`<b class=${f.side}>?</b>${sideName(f.side)} line, unexplored`
      // Only an admin's tiles carry an id: they open the study page without uncovering anything.
      if (f.id) return html`<a class="fogn" style=${style} href="#opening-${f.id}" draggable="false" title="View this hidden opening's page">${label}</a>`
      return html`<div class="fogn" style=${style} title="Finishing a mission uncovers the hidden opening that is most popular on chess.com.">${label}</div>`
    }
    if (it.faint) return html`<div class="via faint" style=${style} title="A move played on the way. It is not an opening of its own here.">${NOT_BOOK}</div>`
    if (it.via) return html`<div class="via" style=${style} title="${it.via} is played on the way. It is not an opening of its own here.">${NOT_BOOK}<span class="mvn">${it.via}</span></div>`
    const n = it.node
    if (n.status === 'start') return html`<div class="node start" style=${style}>${board(n.fen)}<span class="nm">The starting position</span></div>`
    return tile(n, { fresh: this.fresh?.has(n.id), style })
  }

  render() {
    const s = this.state
    const { all, edges, width, height } = layout(s)
    const v = this.view ?? { k: 1, x: 28, y: 28 }
    return html`
      <div class="viewport" @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp}
        @pointercancel=${this.onUp} @click=${{ handleEvent: (e) => this.onClickCapture(e), capture: true }}>
        <div class="tools" @pointerdown=${(e) => e.stopPropagation()}>
          <button @click=${() => { this.glide(); this.fit() }}>Fit</button>
          <button aria-label="Zoom in" @click=${() => { this.glide(); this.zoom(1.25) }}>+</button>
          <button aria-label="Zoom out" @click=${() => { this.glide(); this.zoom(0.8) }}>−</button>
        </div>
        <div class="canvas" style="width:${width}px;height:${height}px;transform:translate(${v.x}px,${v.y}px) scale(${v.k})">
          <svg width=${width} height=${height} aria-hidden="true">${edges.map(({ from, to }) => {
            // Lines run from diagram to diagram, not from the edges of the tiles.
            const faint = to.fog || to.faint
            const mid = (it) => it.y + ((it.via && !it.faint) || (it.node && it.node.status !== 'start') ? BOARD_MID : it.h / 2 - (it.node ? 12 : 0))
            const x1 = from.x + (from.faint ? 36 : from.via ? W / 2 + VIA_HALF : (W + BOARD) / 2 + 10), y1 = mid(from)
            const x2 = to.x + (faint ? 4 : to.via ? W / 2 - VIA_HALF : (W - BOARD) / 2 - 10), y2 = mid(to), m = (x1 + x2) / 2
            return svg`<path d="M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}" fill="none"
              stroke=${faint ? 'var(--muted)' : 'var(--ink)'} stroke-width="1"
              stroke-dasharray=${faint ? '1 4' : nothing} stroke-linecap="round" />`
          })}</svg>
          ${all.map((it) => this.renderNode(it))}
        </div>
      </div>`
  }
}
customElements.define('cb-map', CbMap)

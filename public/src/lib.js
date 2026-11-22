import { html, LitElement, nothing } from 'lit'

/** Components render into the page itself so one stylesheet covers everything. */
export class View extends LitElement {
  createRenderRoot() {
    return this
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data })
  return data
}

// Solid glyphs for both colours; CSS colours them. ︎ stops the pawn rendering as an emoji.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }

/** A board drawn from the piece-placement part of a FEN. `flip` shows it from Black's side. */
export function board(fen, flip = false) {
  const cells = []
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push({ r, f: f++, p: '' })
      else cells.push({ r, f: f++, p: ch })
    }
  })
  if (flip) cells.reverse()
  return html`<div class="board" role="img" aria-label="Chess position">${cells.map((c) => {
    const white = c.p && c.p === c.p.toUpperCase()
    return html`<i class="${(c.r + c.f) % 2 ? 'd' : ''} ${white ? 'w' : ''}">${c.p ? GLYPH[c.p.toLowerCase()] + '︎' : ''}</i>`
  })}</div>`
}

export const sideName = (s) => (s === 'w' ? 'White' : 'Black')
export const dot = (s) => html`<span class="dot ${s}" title="${sideName(s)}"></span>`

export function ago(unix) {
  if (!unix) return 'never'
  const s = Math.max(0, Date.now() / 1000 - unix)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export function day(unix) {
  return new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export const resultWord = { win: 'Win', loss: 'Loss', draw: 'Draw' }

/** Advice accuracy as a chip: green at or above the target, red below. */
export function accuracy(score, threshold) {
  return html`<span class="chip ${score >= threshold ? 'ok' : 'bad'}">${score}%</span>`
}

const MARK = { pass: '✓', partial: '◐', fail: '✗', na: '–' }
const MARK_WORD = { pass: 'Followed', partial: 'Partly followed', fail: 'Not followed', na: 'Did not come up' }

/** One game's advice, idea by idea, for each opening it reached. */
export function adviceDetail(advice, threshold) {
  return html`<div class="advice">${advice.openings.map((o) => html`<div>
    <div class="row"><a href="#opening-${o.id}"><b>${o.name}</b></a>
      ${o.score === null ? html`<span class="muted">none of its advice came up</span>` : accuracy(o.score, threshold)}</div>
    <ul class="marks">${o.checks.map((c) => html`<li class=${c.status}>
      <span class="mark" title=${MARK_WORD[c.status]}>${MARK[c.status]}</span>
      <span>${c.text}${c.note ? html` <span class="mv muted">${c.note}</span>` : nothing}</span></li>`)}</ul>
  </div>`)}</div>`
}

/** The verdict chip and its explanation, shared by the sidebar and the game log. */
export function verdict(v, { short = false } = {}) {
  switch (v.type) {
    case 'counted':
      return html`<span class="chip ok">Counted${short ? '' : ` · ${v.nodeName} ${v.count}/${v.target}`}</span>`
    case 'opponent_left':
      return short
        ? html`<span class="chip">Opp. left <span class="mv">${v.move}</span></span>`
        : html`<span class="chip">Opponent left the line</span> <span class="mv">${v.move}</span>, ${v.nodeName} needs <span class="mv">${v.expected}</span>`
    case 'you_left':
      return short
        ? html`<span class="chip bad">You left <span class="mv">${v.move}</span></span>`
        : html`<span class="chip bad">You left the line</span> <span class="mv">${v.move}</span>, ${v.nodeName} needs <span class="mv">${v.expected}</span>`
    case 'ended_early':
      return html`<span class="chip">Ended early</span>${short ? '' : ` before reaching ${v.nodeName}`}`
    case 'not_eligible':
      return html`<span class="chip">Not eligible</span>${short ? '' : ` ${v.reason}`}`
    case 'before_mission':
      return html`<span class="chip">Too early</span>${short ? '' : ` finished before ${v.nodeName} became your mission`}`
    case 'no_mission':
      return html`<span class="chip">No mission</span>${short ? '' : ' nothing active for this colour'}`
    case 'history':
      return html`<span class="chip">Before you started</span>`
    default:
      return html`<span class="chip">Not judged yet</span>`
  }
}

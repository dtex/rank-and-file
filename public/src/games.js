import { html, nothing } from 'lit'
import { View, accuracy, adviceDetail, api, day, resultWord, sideName, verdict } from './lib.js'

const FILTERS = [
  ['all', 'All', () => true],
  ['counted', 'Counted', (v) => v.type === 'counted'],
  ['opponent_left', 'Opponent left the line', (v) => v.type === 'opponent_left'],
  ['you_left', 'I left the line', (v) => v.type === 'you_left'],
  ['advice', 'Advice below target', (v, g, t) => g.advice?.score != null && g.advice.score < t],
  ['other', 'Did not apply', (v) => ['not_eligible', 'ended_early', 'before_mission', 'no_mission'].includes(v.type)],
  ['history', 'Before I started', (v) => v.type === 'history'],
]

class CbGames extends View {
  static properties = { version: {}, data: { state: true }, filter: { state: true }, error: { state: true }, open: { state: true } }

  constructor() {
    super()
    this.open = new Set()
    try {
      this.filter = localStorage.getItem('cb-game-filter') || 'all'
    } catch {
      this.filter = 'all'
    }
  }

  willUpdate(changed) {
    // `version` bumps after every sync.
    if (changed.has('version')) this.load()
  }

  async load() {
    try {
      this.data = await api('/api/games')
    } catch (err) {
      this.error = err.message
    }
  }

  toggle(uuid) {
    const open = new Set(this.open)
    open.has(uuid) ? open.delete(uuid) : open.add(uuid)
    this.open = open
  }

  setFilter(id) {
    this.filter = id
    try {
      localStorage.setItem('cb-game-filter', id)
    } catch { /* private window */ }
  }

  render() {
    if (this.error) return html`<div class="page"><p style="color:var(--bad)">Could not load games. ${this.error}</p></div>`
    if (!this.data) return html`<div class="page"><p class="muted">Loading…</p></div>`
    const { games, total, adviceThreshold: target } = this.data
    const active = FILTERS.find(([id]) => id === this.filter) ?? FILTERS[0]
    const rows = games.filter((g) => active[2](g.verdict, g, target))
    return html`<div class="page">
      <div>
        <h2>Games</h2>
        <p class="stand">${total > games.length ? `The latest ${games.length} of ${total} synced games.` : `${total} synced games.`}
          Each one is judged once against the mission for the colour you played. Advice is how closely you followed
          the ideas of the openings you have uncovered; select a score to see why.</p>
        <div class="filters">${FILTERS.map(([id, label, test]) => {
          const n = games.filter((g) => test(g.verdict, g, target)).length
          return html`<button class="chip ${this.filter === id ? 'on' : ''}" @click=${() => this.setFilter(id)}>${label} ${n}</button>`
        })}</div>
      </div>
      ${rows.length
        ? html`<div class="tblwrap"><table>
            <tr><th>Date</th><th>Side</th><th>Opponent</th><th>Type</th><th>Result</th><th>Opening reached</th><th>Advice</th><th>Verdict</th></tr>
            ${rows.map((g) => html`<tr>
              <td class="nw"><a href=${g.url} target="_blank" rel="noopener">${day(g.end)}</a></td>
              <td class="nw">${g.side ? sideName(g.side) : nothing}</td>
              <td class="nw">${g.opponent} <span class="muted">(${g.opponentRating})</span></td>
              <td class="nw"><span style="text-transform:capitalize">${g.timeClass}</span> <span class="muted">${g.timeControl}</span></td>
              <td>${resultWord[g.result] ?? ''}</td>
              <td>${!g.opening ? html`<span class="muted">Off the map</span>`
                : g.opening.hidden ? html`<span class="hid">Undiscovered opening</span>`
                : html`<a href="#opening-${g.opening.id}">${g.opening.name}</a>`}</td>
              <td class="nw">${g.advice?.score == null ? html`<span class="muted">–</span>`
                : html`<button class="link" aria-expanded=${this.open.has(g.uuid)} title="Show how this was scored"
                    @click=${() => this.toggle(g.uuid)}>${accuracy(g.advice.score, target)}</button>`}</td>
              <td>${verdict(g.verdict)}</td>
            </tr>
            ${g.advice && this.open.has(g.uuid) ? html`<tr class="sub"><td colspan="8">${adviceDetail(g.advice, target)}</td></tr>` : nothing}`)}
          </table></div>`
        : html`<p class="muted" style="margin-top:16px">${this.filter === 'all'
            ? 'No games yet. Use "Check for new games" after you finish one.'
            : 'No games match this filter.'}</p>`}
    </div>`
  }
}
customElements.define('cb-games', CbGames)

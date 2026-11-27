import { html, nothing } from 'lit'
import { View, accuracy, adviceDetail, api, board, day, resultWord, sideName, tile } from './lib.js'

const STATUS = { active: 'Active mission', parked: 'Parked mission', done: 'Complete', hidden: 'Admin view, still hidden', locked: 'Admin view, locked' }

class CbOpening extends View {
  static properties = { openingId: {}, version: {}, data: { state: true }, error: { state: true } }

  willUpdate(changed) {
    if (changed.has('openingId') || changed.has('version')) this.load()
  }

  async load() {
    this.error = ''
    try {
      this.data = await api(`/api/openings/${encodeURIComponent(this.openingId)}`)
    } catch (err) {
      this.data = null
      this.error = err.message
    }
  }

  render() {
    if (this.error) return html`<div class="page"><div><p>${this.error}</p><p><a href="#openings">Back to your openings</a></p></div></div>`
    const o = this.data
    if (!o) return html`<div class="page"><p class="muted">Loading…</p></div>`
    const s = o.stats
    const max = Math.max(1, ...s.elsewhere.map((e) => e.count))
    const pct = s.of ? Math.round((s.reached / s.of) * 100) : 0
    const a = o.advice
    const am = a.mission?.status === 'active' ? a.mission : null
    const r = s.byRating
    const rated = r.weaker.games + r.even.games + r.stronger.games
    const band = (label, b, bad = false) => html`<tr class=${bad ? 'bad' : ''}><td>${label}</td><td>${b.games}</td>
      ${b.games ? html`<td>${b.win}–${b.draw}–${b.loss}</td><td>${b.score}%</td>` : html`<td class="na">–</td><td class="na">–</td>`}</tr>`
    const list = (xs) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1')
    return html`<div class="page"><article class="article">
      <p><a class="caps" href="#openings">← Openings</a></p>
      <div class="caps kicker">${STATUS[o.status]} · ${o.count} of ${o.target}</div>
      <h2>${o.name}</h2>
      <p class="stand">${o.blurb}</p>
      <div class="byline caps"><span>Playing <b>${sideName(o.side)}</b></span><span>Line <b class="mv">${o.moves}</b></span>${o.eco
        ? html`<span>ECO <b>${o.eco}</b></span>` : nothing}</div>
      <div class="detail">
        <figure>${board(o.fen, o.side === 'b')}
          <figcaption><b>Diagram</b>The position after ${o.lastMove}. Reach it ${o.target} times as ${sideName(o.side)}.</figcaption></figure>
        <div>
          <p class="mvline"><b>Your moves</b> are ${list(o.yourMoves)}.${o.theirMoves.length
            ? html` <b>Your opponent has to play</b> ${list(o.theirMoves)}.` : nothing}</p>
          <ol class="ideas">${o.ideas.map((i, n) => html`<li><b>${n + 1}</b><span>${i.text}
            ${i.of ? html`<small class=${i.followed === i.of ? '' : 'bad'} title="Games where this came up, out of your last ${a.games} scored here">Followed in ${i.followed} of ${i.of} games</small>` : nothing}</span></li>`)}</ol>
          <div class="links caps">
            <a href=${o.links.chesscom} target="_blank" rel="noopener">Open position on chess.com</a>
            <a href=${o.links.lichess} target="_blank" rel="noopener">Lichess explorer</a>
          </div>
        </div>
        <aside class="box">
          <h4>Your record here, as ${sideName(o.side)}</h4>
          <p class="pull">${pct}%</p>
          <p>of your ${sideName(o.side)} games reach this position: ${s.reached} of ${s.of}.</p>
          <table>
            <tr><td>Won</td><td>${s.record.win}</td></tr>
            <tr><td>Drawn</td><td>${s.record.draw}</td></tr>
            <tr><td>Lost</td><td>${s.record.loss}</td></tr>
            <tr><td>Advice accuracy${a.games ? `, last ${a.games}` : ''}</td><td>${a.average === null ? '–' : accuracy(a.average, a.threshold)}</td></tr>
          </table>
          ${rated
            ? html`<h4>By opponent rating</h4>
                <table class="bands">
                  <tr><th>Opponents</th><th>Games</th><th title="Won, drawn, lost">W–D–L</th><th>Score</th></tr>
                  ${band('Weaker', r.weaker)}${band('Your level', r.even)}${band('Stronger', r.stronger, r.struggling)}
                </table>
                <p class="fine" style="margin-top:8px">Weaker and stronger mean more than ${r.band} points below or above your rating in that game.
                  ${r.unrated ? `${r.unrated} game${r.unrated === 1 ? '' : 's'} against unrated opponents, such as the computer, ${r.unrated === 1 ? 'is' : 'are'} left out.` : ''}</p>
                ${s.trend
                  ? html`<p class="trend">Your last ${s.trend.window} games here scored <b class=${s.trend.recent < s.trend.before ? 'down' : ''}>${s.trend.recent}%</b>,
                      ${s.trend.recent < s.trend.before ? `down from ${s.trend.before}%` : s.trend.recent > s.trend.before ? `up from ${s.trend.before}%` : 'the same as'} in the ${s.trend.window} before.</p>`
                  : nothing}`
            : nothing}
          ${am
            ? html`<h4 class="kicker">Advice mission</h4>
                <p>Your last ${am.of} games here averaged ${am.startAverage}%. Bring the average of your last ${am.of} back up to ${am.threshold}%.
                  ${am.played ? `${am.played} played since, and it stands at ${am.current}%.` : 'None played since.'}</p>`
            : a.average === null
              ? html`<p class="fine" style="margin-top:10px">Scored on games you finish after uncovering this opening, when its advice comes up.</p>`
              : nothing}
          ${s.elsewhere.length
            ? html`<h4>Where the other ${s.missed} went</h4>
                ${s.elsewhere.map((e) => html`<div class="barrow ${e.mine ? 'mine' : ''}">
                  <span class="mv">${e.move}${e.mine ? ' (you)' : ''}</span>
                  <span class="meter"><s style="width:${(e.count / max) * 100}%"></s></span><span>${e.count}</span></div>`)}
                <p class="fine" style="margin-top:10px">Counts every eligible game you have played as ${sideName(o.side)}, including before the mission.</p>`
            : nothing}
        </aside>
      </div>

      ${o.history.length
        ? html`<div class="section history"><div class="rule">History</div>
            ${o.history.map((p) => html`<p>${p}</p>`)}</div>`
        : nothing}

      ${o.children.length || o.hiddenChildren
        ? html`<div class="section"><div class="rule">From here</div>
            <div class="cards">${o.children.map((n) => tile(n))}</div>
            ${o.hiddenChildren ? html`<p class="fine" style="margin-top:14px">${o.hiddenChildren} hidden opening${o.hiddenChildren === 1 ? '' : 's'} beyond this one.</p>` : nothing}</div>`
        : nothing}

      ${a.recent.length
        ? html`<div class="section"><div class="rule" style="border-top:0;margin:0">How you followed the advice, latest first</div>
            <div class="tblwrap" style="margin-top:6px"><table>
              <tr><th>Game</th><th>Idea by idea</th></tr>
              ${a.recent.map((g) => html`<tr>
                <td class="nw"><a href=${g.url} target="_blank" rel="noopener">${day(g.end)}</a><br>
                  <span class="muted">${resultWord[g.result]} v ${g.opponent}</span></td>
                <td>${adviceDetail(g.advice, a.threshold)}</td></tr>`)}
            </table></div></div>`
        : nothing}

      ${o.missionGames.length
        ? html`<div class="section"><div class="rule" style="border-top:0;margin:0">Games that counted</div>
            <div class="tblwrap" style="margin-top:6px"><table>
              <tr><th>Date</th><th>Opponent</th><th>Type</th><th>Result</th></tr>
              ${o.missionGames.map((g) => html`<tr>
                <td class="nw"><a href=${g.url} target="_blank" rel="noopener">${day(g.end)}</a></td>
                <td>${g.opponent} <span class="muted">(${g.opponentRating})</span></td>
                <td><span style="text-transform:capitalize">${g.timeClass}</span> <span class="muted">${g.timeControl}</span></td>
                <td>${resultWord[g.result]}</td></tr>`)}
            </table></div></div>`
        : nothing}
    </article></div>`
  }
}
customElements.define('cb-opening', CbOpening)

// Shared by the Phase 1 comps: sample data and the pieces of the app each frame is built from.
// The markup copies what public/src renders, class for class, so app.css draws it as the app would.
// Nothing here is wired to the app. Words wrapped in <span class="new"> are the ones each option adds.
window.Kit = (() => {
  const DATE = 'Thursday, 26 November 2026'
  const ACCOUNTS = 'kestrel77 on chess.com, kestrel77 on Lichess'
  const TAGLINE = 'Chess training for the rest of us'

  /** The masthead. `dl` replaces the "accounts · synced" text; `button` is the sync link's label. */
  function mast({ dl = `${ACCOUNTS} · synced 2 h ago`, button = 'Check for new games', busy = false, tab = 'openings' } = {}) {
    const tabs = [['openings', 'Openings'], ['games', 'Games'], ['settings', 'Settings']]
    return `<header class="mast">
      <div class="dl caps"><span>${DATE}</span><span class="sp"></span><span>${dl}</span>
        <button class="link" ${busy ? 'disabled' : ''}>${button}</button></div>
      <a class="brand" href="#">Rank <em>&amp;</em> File</a>
      <div class="tagline">${TAGLINE}</div>
      <nav class="tabs caps">${tabs.map(([id, l]) => `<a class="tab ${id === tab ? 'on' : ''}" href="#">${l}</a>`).join('')}</nav>
    </header>`
  }

  const notice = (text, err = false) =>
    `<div class="notice ${err ? 'err' : ''}" role="status"><span>${text}</span><span class="sp"></span><button class="link">Dismiss</button></div>`

  const pips = (n, of) => `<span class="pips">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`

  // The outline, open two levels, as cb-outline draws it. `marks` puts extra markup in a row's status, by opening id.
  const row = (n, kids = '', marks = {}) => `<li><div class="orow ${n.status}">
      <span class="twist">${kids ? '▾' : ''}</span>
      <a class="oname" href="#"><span class="dot ${n.side}"></span><b class="mvn">${n.last}</b><span class="nm">${n.name}</span>
        ${n.moves ? `<span class="mv">${n.moves}</span>` : ''}${marks.under?.[n.id] ?? ''}</a>
      <span class="ost">${marks[n.id] ?? ''}<span class="caps">${n.word}</span>${n.status === 'done' ? '' : pips(n.count, n.target)}</span>
    </div>${kids ? `<ul>${kids}</ul>` : ''}</li>`
  const fog = (side) => `<li class="ofog"><span class="twist"></span><span><b class="${side}">?</b><span>${side === 'w' ? 'White' : 'Black'} line, unexplored</span></span></li>`
  const outline = (m = {}) => `<div class="oscroll"><div class="otools caps"><button class="link">Open all</button><button class="link">Close all</button></div>
    <ul class="outline">
      ${row({ id: 'kp', status: 'done', side: 'w', last: '1.e4', name: "King's Pawn Opening", word: 'Complete' },
        row({ id: 'open', status: 'done', side: 'b', last: '1...e5', name: 'Open Game', moves: '1.e4 e5', word: 'Complete' },
          row({ id: 'knight', status: 'active', side: 'w', last: '2.Nf3', name: "King's Knight Opening", moves: '1.e4 e5 2.Nf3', word: 'Active mission', count: 4, target: 6 }, '', m) + fog('w'), m)
        + row({ id: 'sicilian', status: 'active', side: 'b', last: '1...c5', name: 'Sicilian Defense', moves: '1.e4 c5', word: 'Active mission', count: 3, target: 8 }, '', m) + fog('b') + fog('b'), m)}
      ${fog('w')}${fog('w')}
    </ul></div>`

  // Solid glyphs for both colours, as public/src/lib.js draws them.
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  function board(fen, flip = false) {
    const cells = []
    fen.split(' ')[0].split('/').forEach((r, ri) => {
      let f = 0
      for (const ch of r) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push({ r: ri, f: f++, p: '' })
        else cells.push({ r: ri, f: f++, p: ch })
      }
    })
    if (flip) cells.reverse()
    return `<div class="board">${cells.map((c) => {
      const white = c.p && c.p === c.p.toUpperCase()
      return `<i class="${(c.r + c.f) % 2 ? 'd' : ''} ${white ? 'w' : ''}">${c.p ? GLYPH[c.p.toLowerCase()] + '︎' : ''}</i>`
    }).join('')}</div>`
  }

  /** The Sicilian's page as public/src/opening.js draws it. `inBox` goes after the record table, `below` after the three columns. */
  function opening({ inBox = '', afterBox = '', below = '', mast: m = {}, rec = { reached: 45, of: 120, win: 23, draw: 3, loss: 19 } } = {}) {
    const idea = (n, text, f, of) => `<li><b>${n}</b><span>${text}<small class="${f === of ? '' : 'bad'}">Followed in ${f} of ${of} games</small></span></li>`
    const bar = (mv, n, mine, max = 38) => `<div class="barrow ${mine ? 'mine' : ''}"><span class="mv">${mv}${mine ? ' (you)' : ''}</span><span class="meter"><s style="width:${(n / max) * 100}%"></s></span><span>${n}</span></div>`
    return `${mast(m)}<div class="page"><article class="article">
      <p><a class="caps" href="#">← Openings</a></p>
      <div class="caps kicker">Active mission · 3 of 8</div>
      <h2>Sicilian Defense</h2>
      <p class="stand">Black fights for d4 from the side instead of matching White in the centre. The positions are unbalanced from move one.</p>
      <div class="byline caps"><span>Playing <b>Black</b></span><span>Line <b class="mv">1.e4 c5</b></span><span>ECO <b>B20</b></span></div>
      <div class="detail">
        <figure>${board('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR', true)}
          <figcaption><b>Diagram</b>The position after 1...c5. Reach it 8 times as Black.</figcaption></figure>
        <div>
          <p class="mvline"><b>Your moves</b> are 1...c5. <b>Your opponent has to play</b> 1.e4.</p>
          <ol class="ideas">
            ${idea('i', 'If White plays d4, trade your c-pawn for it and keep two centre pawns.', 2, 2)}
            ${idea('ii', 'Develop with ...d6 or ...Nc6, then ...Nf6.', 2, 4)}
            <li><b>iii</b><span>The half-open c-file is your long-term asset.</span></li>
          </ol>
          <div class="links caps"><a href="#">Open position on chess.com</a><a href="#">Lichess explorer</a></div>
        </div>
        <aside class="box">
          <h4>Your record here, as Black</h4>
          <p class="pull">${Math.round((rec.reached / rec.of) * 100)}%</p>
          <p>of your Black games reach this position: ${rec.reached} of ${rec.of}.</p>
          <table>
            <tr><td>Won</td><td>${rec.win}</td></tr><tr><td>Drawn</td><td>${rec.draw}</td></tr><tr><td>Lost</td><td>${rec.loss}</td></tr>
            <tr><td>Advice accuracy, last 4</td><td><b class="acc bad">69%</b></td></tr>
          </table>
          ${inBox}
          <h4>Where the other ${rec.of - rec.reached} went</h4>
          ${(rec.elsewhere ?? [38, 21, 9, 7]).map((n, i) => bar(['1.d4', '1...e5', '1.Nf3', '1.c4'][i], n, i === 1, rec.elsewhere?.[0])).join('')}
          <p class="fine" style="margin-top:10px">Counts every eligible game you have played as Black, including before the mission.</p>
          ${afterBox}
        </aside>
      </div>
      ${below}
      <div class="section history"><div class="rule">History</div>
        <p>The name comes from the Italian Giulio Polerio, who wrote about it in 1594, though it was a Sicilian priest who made it known.</p></div>
    </article></div>`
  }

  /** The Openings sidebar. `top` goes above the plan card, where a one-off note would sit. */
  function sidebar({ top = '' } = {}) {
    const res = (verb, side, name, v) => `<div class="res"><b>${verb}</b> as ${side}, ${name}.<span>${v}</span></div>`
    return `<aside class="sidebar">
      ${top}
      <div class="mcard" style="margin:0"><span class="chip">Free plan</span><span class="muted"> 3 of 4 free openings uncovered</span></div>
      <div><h3>Active missions</h3>
        <a class="as" href="#"><span class="caps who">As White</span><h4>King's Knight Opening</h4><span class="mv">1.e4 e5 2.Nf3</span>
          <span class="ct"><b>4<small>/6</small></b>${pips(4, 6)}</span><span class="note">Reached in 11 of your last 20 White games.</span></a>
        <a class="as" href="#"><span class="caps who">As Black</span><h4>Sicilian Defense</h4><span class="mv">1.e4 c5</span>
          <span class="ct"><b>3<small>/8</small></b>${pips(3, 8)}</span><span class="note">Reached in 6 of your last 20 Black games.</span></a>
      </div>
      <div><h3>Latest results</h3>
        ${res('Won', 'White', "King's Knight Opening", '<span class="chip ok">Counted</span> · advice <b class="acc ok">83%</b>')}
        ${res('Lost', 'Black', 'Sicilian Defense', '<span class="chip">Opp. left <span class="mv">2.c3</span></span> · advice <b class="acc bad">50%</b>')}
        ${res('Drew', 'White', 'off the map', '<span class="chip">Not eligible</span>')}
        <p style="margin-top:12px"><a class="caps" href="#">All games</a></p>
      </div>
    </aside>`
  }

  /** The Openings screen: masthead, notice, outline and sidebar. */
  const openings = ({ mast: m = {}, notice: n = '', top = '', marks = {} } = {}) =>
    `${mast(m)}${n}<cb-openings><div class="omain outline"><div class="viewbar"><div class="seg">
      <button aria-pressed="false">Map</button><button aria-pressed="true">Outline</button></div></div>${outline(marks)}</div>${sidebar({ top })}</cb-openings>`

  /** The top of the Games screen, with its standfirst. */
  const games = ({ stand, mast: m = {} }) => `${mast({ ...m, tab: 'games' })}<div class="page"><div>
      <h2>Games</h2>
      <p class="stand">${stand}</p>
      <div class="filters">${[['All', 214, 1], ['Counted', 23], ['Opponent left the line', 41], ['I left the line', 18], ['Advice below target', 12], ['Did not apply', 67], ['Before I started', 53]]
        .map(([l, n, on]) => `<button class="chip ${on ? 'on' : ''}">${l} ${n}</button>`).join('')}</div>
      <div class="tblwrap"><table>
        <tr><th>Date</th><th>Side</th><th>Opponent</th><th>Type</th><th>Result</th><th>Opening reached</th><th>Advice</th><th>Verdict</th></tr>
        <tr><td class="nw"><a href="#">26 Nov</a></td><td>White</td><td class="nw">tal_fan <span class="muted">(1468)</span></td><td class="nw">Rapid <span class="muted">10+0 · chess.com</span></td><td>Win</td><td><a href="#">King's Knight Opening</a></td><td><button class="link"><b class="acc ok">83%</b></button></td><td><span class="chip ok">Counted · King's Knight Opening 4/6</span></td></tr>
        <tr><td class="nw"><a href="#">25 Nov</a></td><td>Black</td><td class="nw">Morphy_Jr <span class="muted">(1531)</span></td><td class="nw">Blitz <span class="muted">5+3 · Lichess</span></td><td>Loss</td><td><a href="#">Sicilian Defense</a></td><td><button class="link"><b class="acc bad">50%</b></button></td><td><span class="chip">Opponent left the line</span> <span class="mv">2.c3</span>, Sicilian Defense needs <span class="mv">2.Nf3</span></td></tr>
      </table></div>
    </div></div>`

  /** One numbered frame: a label, the slice of the app, and notes. */
  const frame = (n, label, body, cap, h) => `<section class="fr"><div class="caps"><b>${n}</b><span>${label}</span></div>
    <div class="shot"><div class="app" style="${h ? `--h:${h}px` : ''}">${body}</div></div><p class="fcap">${cap}</p></section>`

  /** The bar across the top of every comp page: the options, and light or dark. */
  function top(current) {
    const phases = [
      ['Phase 1 · First 30 moves', [['index.html', 'Overview'], ['a-notice.html', 'A'], ['b-dateline.html', 'B'], ['c-column-note.html', 'C']]],
      ['Phase 2 · Results by rating', [['p2-index.html', 'Overview'], ['p2-a-box.html', 'A'], ['p2-b-section.html', 'B'], ['p2-c-headline.html', 'C']]],
    ]
    return `<div class="comp-top caps">
      ${phases.map(([name, pages]) => `<span class="grp"><span>${name}</span>
        ${pages.map(([href, l]) => `<a class="${href === current ? 'on' : ''}" href="${href}">${l}</a>`).join('')}</span>`).join('')}
      <span class="sp"></span>
      <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="clean"> Hide highlights</label>
      <span class="seg" role="group" aria-label="Appearance">${['Light', 'Dark'].map((t) => `<button data-theme-set="${t.toLowerCase()}">${t}</button>`).join('')}</span>
    </div>`
  }

  function mount(current) {
    document.getElementById('top').innerHTML = top(current)
    const set = (t) => {
      document.documentElement.dataset.theme = t
      document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)))
    }
    set(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => set(b.dataset.themeSet)))
    document.getElementById('clean').addEventListener('change', (e) => document.body.classList.toggle('clean', e.target.checked))
    // Nothing in a frame goes anywhere.
    document.addEventListener('click', (e) => { if (e.target.closest('.app a, .app button')) e.preventDefault() })
  }

  const JUST = { dl: `${ACCOUNTS} · synced just now` }

  return { ACCOUNTS, JUST, opening, openings, games, notice, frame, mount }
})()

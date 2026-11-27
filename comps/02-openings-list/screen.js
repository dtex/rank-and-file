// Draws the Openings screen with one of the four alternatives in place of the outline. screen.html?opt=a|b|c|d
// The masthead, the Map/… switch and the sidebar copy what public/src renders, class for class, so app.css
// draws them as the app would. Only option D responds to clicks; nothing here is wired to the app.
(() => {
  const params = new URLSearchParams(location.search)
  const opt = params.get('opt') || 'a'
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme')

  // The sample openings as a tree, with the unexplored lines counted on the opening they hang off.
  const byId = new Map(window.SAMPLE.nodes.map((n) => [n.id, { ...n, kids: [], fog: { w: 0, b: 0 } }]))
  const start = { id: 'start', name: 'Starting position', side: 'b', plies: [], kids: [], fog: { w: 0, b: 0 }, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR' }
  const at = (id) => (id === 'start' ? start : byId.get(id))
  for (const n of byId.values()) at(n.parent).kids.push(n)
  for (const f of window.SAMPLE.fog) at(f.parent).fog[f.side]++
  /** Every opening in map order: each one followed by what comes after it. */
  const walk = (n, out = []) => { for (const k of n.kids) { out.push(k); walk(k, out) } return out }
  const all = walk(start)
  const sideName = (s) => (s === 'w' ? 'White' : 'Black')
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const WORD = { active: 'Active mission', parked: 'Parked', done: 'Complete' }

  const pips = (n, of) => `<span class="pips" role="img" aria-label="${n} of ${of}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  function board(fen, flip = false) {
    const cells = []
    fen.split('/').forEach((row, r) => {
      let f = 0
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push({ r, f: f++, p: '' })
        else cells.push({ r, f: f++, p: ch })
      }
    })
    if (flip) cells.reverse()
    return `<div class="board" role="img" aria-label="Chess position">${cells.map((c) => {
      const white = c.p && c.p === c.p.toUpperCase()
      return `<i class="${(c.r + c.f) % 2 ? 'd' : ''} ${white ? 'w' : ''}">${c.p ? GLYPH[c.p.toLowerCase()] + '︎' : ''}</i>`
    }).join('')}</div>`
  }
  /** The marks an opening can carry: a poor score against stronger opponents, and an advice mission. */
  const marks = (n) => `${n.struggling ? `<span class="caps vs" title="${n.struggling.games} games against stronger opponents, scoring ${n.struggling.score}%">${n.struggling.score}% v stronger</span>` : ''}${
    n.adviceMission ? `<span class="flag" title="Advice mission: follow this opening's ideas more closely">!</span>` : ''}`
  /** Unexplored lines as squares with a count: white ones, then black. */
  const fogCount = (fog) => ['w', 'b'].filter((s) => fog[s]).map((s) => `<b class="q ${s}" title="${sideName(s)} lines, unexplored">?</b>${fog[s]}`).join('')

  // ── A · Lines ───────────────────────────────────────────────────────────────────────────────────────────
  function lines() {
    const turns = Math.ceil(Math.max(...all.map((n) => n.plies.length)) / 2)
    const filters = [['all', 'All', () => true], ['active', 'Active', (n) => n.status === 'active'], ['parked', 'Parked', (n) => n.status === 'parked'],
      ['done', 'Complete', (n) => n.status === 'done'], ['w', 'As White', (n) => n.side === 'w'], ['b', 'As Black', (n) => n.side === 'b']]
    const row = (n, i, list) => {
      const brk = i > 0 && n.plies[0] !== list[i - 1].plies[0]
      const line = n.plies.map((san, p) => `<span class="${p === n.plies.length - 1 ? 'own' : ''}">${p % 2 ? '' : `${p / 2 + 1}.`}${san}</span>`).join('')
      return `<tr class="${n.status} ${brk ? 'brk' : ''}" data-status="${n.status}" data-side="${n.side}">
        <td><span class="ln">${line}</span></td>
        <td class="o"><a class="nm" href="#"><span class="dot ${n.side}" title="${sideName(n.side)}"></span>${n.name}</a>${marks(n) ? `<span class="marks2">${marks(n)}</span>` : ''}</td>
        <td class="prog caps">${WORD[n.status]}${n.status === 'done' ? '' : pips(n.count, n.target)}</td>
        <td class="beyond">${fogCount(n.fog)}</td>
      </tr>`
    }
    return `<div class="oscroll">
      <div class="filters lfilters">${filters.map(([id, label, test]) => `<button class="chip ${id === 'all' ? 'on' : ''}" data-filter="${id}">${label} ${all.filter(test).length}</button>`).join('')}</div>
      <table class="lines" style="--turns:${turns}">
        <tr><th>Line</th><th>Opening</th><th>Progress</th><th>Unexplored</th></tr>
        ${all.map(row).join('')}
      </table>
      <p class="fine">${fogCount(start.fog)} other first moves are still unexplored.</p>
    </div>`
  }
  function wireLines(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]')
      if (!b) return
      const f = b.dataset.filter
      root.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b))
      root.querySelectorAll('.lines tr[data-status]').forEach((tr) => {
        tr.hidden = !(f === 'all' || tr.dataset.status === f || tr.dataset.side === f)
      })
    })
  }

  // ── B · By colour ───────────────────────────────────────────────────────────────────────────────────────
  function byColour() {
    const moves = (n) => n.plies.map((san, p) => {
      const text = `${p % 2 ? '' : `${p / 2 + 1}.`}${san}`
      return p === n.plies.length - 1 ? `<b>${text}</b>` : text
    }).join(' ')
    const item = (n) => `<li class="${n.status}"><a href="#">
      <span class="t"><span class="nm">${n.name}</span>${n.status !== 'done' || marks(n)
        ? `<span class="sub caps">${n.status === 'done' ? '' : `${n.count} of ${n.target}${pips(n.count, n.target)}`}${marks(n)}</span>` : ''}</span>
      <span class="dots"></span><span class="mv">${moves(n)}</span></a></li>`
    const group = (list, label) => (list.length ? `<div class="caps lab">${label}</div><ul class="toc">${list.map(item).join('')}</ul>` : '')
    const column = (side) => {
      const mine = all.filter((n) => n.side === side)
      const fog = window.SAMPLE.fog.filter((f) => f.side === side).length
      return `<section class="rep">
        <div class="rule">As ${sideName(side)} · ${plural(mine.length, 'opening')}</div>
        ${group(mine.filter((n) => n.status === 'active'), 'Active mission')}
        ${group(mine.filter((n) => n.status === 'parked'), 'Parked')}
        ${group(mine.filter((n) => n.status === 'done'), 'Complete')}
        <p class="fine"><b class="q ${side}">?</b>${plural(fog, `${sideName(side)} line`)} within reach, still unexplored.</p>
      </section>`
    }
    return `<div class="oscroll"><div class="cols2">${column('w')}${column('b')}</div></div>`
  }

  // ── C · Diagrams ────────────────────────────────────────────────────────────────────────────────────────
  function diagrams() {
    const tile = (n) => {
      const word = ['parked', 'locked'].includes(n.status) ? n.status : ''
      return `<a class="node ${n.status}" href="#">${board(n.fen, n.side === 'b')}
        <span class="mvn">${n.lastMove}</span><span class="nm">${n.name}</span>
        <span class="pr caps">${pips(n.count, n.target)}${word}${n.adviceMission ? '<span class="flag" title="Advice mission">!</span>' : ''}</span></a>`
    }
    const fogTile = (fog) => {
      const n = fog.w + fog.b
      return n ? `<span class="node fogt" title="Finishing a mission uncovers the hidden opening your games reach most.">
        <span class="blank">?</span><span class="mvn">?</span><span class="nm">${plural(n, 'line')} unexplored</span>
        <span class="pr caps">${[fog.w && `${fog.w} white`, fog.b && `${fog.b} black`].filter(Boolean).join(' · ')}</span></span>` : ''
    }
    const sum = (list) => list.reduce((t, n) => ({ w: t.w + n.fog.w, b: t.b + n.fog.b }), { w: 0, b: 0 })
    const fam = (title, mv, list, fog) => `<section class="fam">
      <div class="rule"><span>${title}</span>${mv ? `<span class="mv">${mv}</span>` : ''}</div>
      <div class="tiles">${list.map(tile).join('')}${fogTile(fog)}</div></section>`
    // The first moves share a section; every reply to one then heads a section of its own.
    const firsts = start.kids
    return `<div class="oscroll"><div class="fams">
      ${fam('First moves', '', firsts, sum([start, ...firsts]))}
      ${firsts.flatMap((f) => f.kids).map((k) => fam(k.name, k.moves, [k, ...walk(k)], sum([k, ...walk(k)]))).join('')}
    </div></div>`
  }

  // ── D · Step through ────────────────────────────────────────────────────────────────────────────────────
  let here = all.find((n) => n.status === 'active' && n.side === 'w')?.id ?? 'start'
  function step() {
    const n = at(here)
    const trail = []
    for (let a = n; a; a = a.id === 'start' ? null : at(a.parent)) trail.unshift(a)
    const mover = n.side === 'w' ? 'b' : 'w'
    const missions = all.filter((m) => m.status === 'active')
    const next = (k) => {
      const beyond = walk(k)
      const leads = beyond.filter((m) => m.status === 'active')
      const more = [beyond.length && `${plural(beyond.length, 'opening')} beyond`, ...leads.map((m) => `<b>leads to your ${sideName(m.side)} mission</b>`)].filter(Boolean).join(', ')
      return `<li><button class="nrow ${k.status}" data-go="${k.id}">
        <span class="t"><b class="mvn">${k.lastMove}</b><span class="nm">${k.name}</span>${more ? `<span class="more">${more}</span>` : ''}</span>
        <span class="ost">${marks(k)}<span class="caps">${WORD[k.status]}</span>${k.status === 'done' ? '' : pips(k.count, k.target)}</span>
        <span class="go" aria-hidden="true">›</span></button></li>`
    }
    const fogRow = (s) => (n.fog[s] ? `<li><span class="nrow fogr" title="Finishing a mission uncovers the hidden opening your games reach most."><b class="q ${s}">?</b>${plural(n.fog[s], `${sideName(s)} line`)}, unexplored</span></li>` : '')
    const status = n.id === 'start' ? `${all.length} openings uncovered`
      : `${WORD[n.status]}${n.status === 'done' ? '' : ` · ${n.count} of ${n.target}`} · as ${sideName(n.side)}`
    return `<div class="oscroll step">
      <div class="jump caps"><span>Go to</span>${missions.map((m) => `<button class="link" data-go="${m.id}">${m.name}</button>`).join('')}<button class="link" data-go="start">The start</button></div>
      <div class="stepg">
        <figure>${board(n.fen, n.id !== 'start' && n.side === 'b')}</figure>
        <div>
          <nav class="trail" aria-label="The moves so far">${trail.map((a, i) => {
            const label = a.id === 'start' ? 'Start' : a.lastMove
            return `${i ? '<span aria-hidden="true">›</span>' : ''}${a === n ? `<b>${label}</b>` : `<button class="link" data-go="${a.id}" title="${a.name}">${label}</button>`}`
          }).join('')}</nav>
          <div class="caps ${n.status === 'active' ? 'kicker' : 'eyebrow'}">${status}</div>
          <h2>${n.name}</h2>
          ${n.id === 'start' ? '<p class="read"></p>' : `<p class="read">${marks(n)} <a class="caps" href="#">Read about this opening</a></p>`}
          <div class="rule">From here · ${sideName(mover)} to move</div>
          <ul class="next">${n.kids.map(next).join('')}${fogRow('w')}${fogRow('b')}</ul>
          ${n.kids.length || n.fog.w || n.fog.b ? '' : '<p class="end">Nothing further along this line yet.</p>'}
        </div>
      </div>
    </div>`
  }

  // ── The screen around them ──────────────────────────────────────────────────────────────────────────────
  const mast = () => `<header class="mast">
    <div class="dl caps"><span>Friday, 27 November 2026</span><span class="sp"></span><span>kestrel77 on chess.com, kestrel77 on Lichess · synced 2 h ago</span>
      <button class="link">Check for new games</button></div>
    <a class="brand" href="#">Rank <em>&amp;</em> File</a>
    <div class="tagline">Chess training for the rest of us</div>
    <nav class="tabs caps"><a class="tab on" href="#">Openings</a><a class="tab" href="#">Games</a><a class="tab" href="#">Settings</a></nav>
  </header>`

  function sidebar() {
    const mission = (side) => {
      const a = all.find((n) => n.status === 'active' && n.side === side)
      const reach = side === 'w' ? 'Reached in 14 of your last 50 White games.' : 'Reached in 9 of your last 50 Black games.'
      return `<a class="as" href="#"><span class="caps who">As ${sideName(side)}</span><h4>${a.name}</h4><span class="mv">${a.moves}</span>
        <span class="ct"><b>${a.count}<small>/${a.target}</small></b>${pips(a.count, a.target)}</span><span class="note">${reach}</span></a>
        ${all.filter((n) => n.status === 'parked' && n.side === side).map((p) => `<div class="row" style="margin:-6px 0 14px">
          <span class="fine">Parked: ${p.name}, ${p.count} of ${p.target}</span><button class="link">Resume</button></div>`).join('')}`
    }
    const res = (verb, side, name, v) => `<div class="res"><b>${verb}</b> as ${side}, ${name}.<span>${v}</span></div>`
    return `<aside class="sidebar">
      <div><h3>Active missions</h3>${mission('w')}${mission('b')}</div>
      <div><h3>Advice missions</h3>
        <a class="as" href="#"><span class="caps who">Follow the advice · as Black</span><h4>Giuoco Piano</h4>
          <span class="ct"><b>62<small>%</small></b></span><span class="note">The average of your last 4 games here. Bring it back up to 75%.</span></a></div>
      <div><h3>Latest results</h3>
        ${res('Won', 'White', 'Italian Game', '<span class="chip ok">Counted</span> · advice <b class="acc ok">83%</b>')}
        ${res('Lost', 'Black', 'Sicilian Defense', '<span class="chip">No mission</span> · advice <b class="acc bad">50%</b>')}
        ${res('Drew', 'White', 'off the map', '<span class="chip">Not eligible</span>')}
        <p style="margin-top:12px"><a class="caps" href="#">All games</a></p></div>
      <div class="fine">16 of 61 openings uncovered, 12 complete.<br><a href="#">Privacy</a> · <a href="#">Terms</a></div>
    </aside>`
  }

  const OPTIONS = { a: ['Lines', lines], b: ['By colour', byColour], c: ['Diagrams', diagrams], d: ['Step through', step] }
  const [label, draw] = OPTIONS[opt] ?? OPTIONS.a
  function render() {
    document.querySelector('cb-app').innerHTML = `${mast()}<cb-openings><div class="omain list">
      <div class="viewbar"><div class="seg" role="group" aria-label="Show the openings as">
        <button aria-pressed="false">Map</button><button aria-pressed="true">${label}</button></div></div>
      ${draw()}</div>${sidebar()}</cb-openings>`
  }
  render()
  if (opt === 'a') wireLines(document.querySelector('cb-app'))
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]')
    if (go) { here = go.dataset.go; render() }
    // Nothing else goes anywhere.
    if (e.target.closest('a')) e.preventDefault()
  })
})()

// The openings editor's page. Plain DOM, no build step: the list on the left, one opening's form on the right.

const state = {
  openings: [],
  sample: {},
  recentDays: 30,
  selected: null, // id of the opening in the form, or null
  draft: null, // the form's values
  isNew: false,
  dirty: false,
  filter: '',
  sort: 'map',
  message: null, // { text, error }
}

/** Build an element: h('p', { class: 'muted', onclick }, 'text', child). */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k in el && k !== 'list') el[k] = v
    else el.setAttribute(k, v)
  }
  el.append(...kids.flat().filter((kid) => kid !== null && kid !== undefined && kid !== false))
  return el
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `The editor's server answered ${res.status}.`)
  return data
}

const number = (n) => n.toLocaleString('en-US')
const byId = (id) => state.openings.find((o) => o.id === id)

/** "12%", "3.4%", "<0.1%", or a dash when there is no sample to measure against. */
function percent({ n, of }) {
  if (!of) return '–'
  const p = (n / of) * 100
  if (n === 0) return '0%'
  if (p < 0.1) return '<0.1%'
  return `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`
}
const share = (r) => (r.of ? r.n / r.of : -1)
const reachTitle = (r, label) => (r.of ? `${number(r.n)} of ${number(r.of)} recent ${label} games` : `No ${label} sample yet`)

// ---------------------------------------------------------------- the sample

function renderSample() {
  const sites = Object.values(state.sample)
  const running = sites.some((s) => s.running && !s.running.error)
  const line = (s) => {
    if (s.running?.error) return h('span', { class: 'error' }, `${s.label}: ${s.running.error}`)
    if (s.running) return h('span', {}, h('b', {}, s.label), ` gathering ${number(s.running.games)} of ${number(s.running.target)}`)
    if (!s.games) return h('span', { class: 'muted' }, h('b', {}, s.label), ' no sample yet')
    const when = new Date(s.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    return h('span', {}, h('b', {}, s.label), ` ${number(s.games)} games`, s.rating ? `, median rating ${number(s.rating)}` : '', `, ${when}`)
  }
  document.getElementById('sample').replaceChildren(
    h('div', { class: 'small' },
      h('div', { class: 'muted' }, `Reach is measured on rated games from the last ${state.recentDays} days`),
      ...sites.map((s) => h('div', {}, line(s)))),
    h('button', { disabled: running, onclick: refreshSample }, running ? 'Gathering…' : 'Refresh sample'),
  )
  if (running) setTimeout(pollSample, 3000)
}

async function refreshSample() {
  state.sample = await api('POST', '/api/sample/refresh')
  renderSample()
}

async function pollSample() {
  state.sample = await api('GET', '/api/sample')
  const done = !Object.values(state.sample).some((s) => s.running && !s.running.error)
  if (done) {
    // New figures for every opening; the form is left alone in case something is half written.
    const fresh = await api('GET', '/api/tree')
    state.openings = fresh.openings
    renderList()
    schedulePreview()
  }
  renderSample()
}

// ---------------------------------------------------------------- the list

/** Openings in map order, each with how many steps it is from the starting position. */
function mapOrder() {
  const children = new Map()
  for (const o of state.openings) children.set(o.parent, [...(children.get(o.parent) ?? []), o])
  const out = []
  const walk = (o, level) => {
    out.push({ o, level })
    for (const c of children.get(o.id) ?? []) walk(c, level + 1)
  }
  for (const root of children.get(null) ?? []) walk(root, 0)
  return out
}

function renderList() {
  const words = state.filter.toLowerCase().split(/\s+/).filter(Boolean)
  let rows = mapOrder().filter(({ o }) => words.every((w) => `${o.name} ${o.aliases.join(' ')} ${o.id} ${o.moves} ${o.eco}`.toLowerCase().includes(w)))
  if (state.sort === 'name') rows.sort((a, b) => a.o.name.localeCompare(b.o.name))
  if (state.sort === 'chesscom' || state.sort === 'lichess') rows.sort((a, b) => share(b.o.reach[state.sort]) - share(a.o.reach[state.sort]))
  const indent = state.sort === 'map' && !words.length

  const search = h('input', { type: 'search', placeholder: 'Find by name, alias, moves, id or ECO', value: state.filter, 'aria-label': 'Find an opening',
    oninput: (e) => { state.filter = e.target.value; renderList(); document.querySelector('.toolbar input').focus() } })
  const sort = h('select', { 'aria-label': 'Order', style: 'width:auto', onchange: (e) => { state.sort = e.target.value; renderList() } },
    [['map', 'Map order'], ['chesscom', 'Most reached on chess.com'], ['lichess', 'Most reached on Lichess'], ['name', 'Name']]
      .map(([value, label]) => h('option', { value, selected: state.sort === value }, label)))

  const body = rows.map(({ o, level }) => h('tr', { class: o.id === state.selected && !state.isNew ? 'selected' : '', onclick: () => select(o.id) },
    h('td', { style: indent ? `padding-left:${12 + level * 14}px` : '' },
      o.side ? h('span', { class: `side ${o.side}`, title: o.side === 'w' ? 'White' : 'Black' }) : null,
      h('span', { title: o.aliases.length ? `Also known as ${o.aliases.join(', ')}` : null }, o.name), ' ', h('span', { class: 'mv' }, o.moves)),
    h('td', { class: 'num', title: reachTitle(o.reach.chesscom, 'chess.com') }, percent(o.reach.chesscom)),
    h('td', { class: 'num', title: reachTitle(o.reach.lichess, 'Lichess') }, percent(o.reach.lichess))))

  const list = document.getElementById('list')
  const scroll = list.scrollTop
  list.replaceChildren(
    h('div', { class: 'toolbar' }, search, sort, h('button', { class: 'primary', onclick: () => startNew(state.isNew ? null : state.selected) }, 'Add opening')),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, `${state.openings.length - 1} openings`), h('th', { class: 'num' }, 'chess.com'), h('th', { class: 'num' }, 'Lichess'))),
      h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colSpan: 3, class: 'muted' }, 'Nothing matches.')))),
  )
  list.scrollTop = scroll
}

// ---------------------------------------------------------------- the form

const leaveOk = () => !state.dirty || confirm('Discard the changes you have not saved?')

function toDraft(o) {
  return {
    id: o.id, parent: o.parent ?? '', name: o.name, aliases: o.aliases.join('\n'), side: o.side ?? '', moves: o.moves, eco: o.eco, target: o.target ?? '', blurb: o.blurb, history: o.history,
    ideas: o.ideas.map((text, i) => ({ text, check: o.checks[i] ? JSON.stringify(o.checks[i]) : '' })),
    extra: Object.entries(o.extra).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })),
  }
}

function select(id, force = false) {
  if (!force && !leaveOk()) return
  Object.assign(state, { selected: id, isNew: false, dirty: false, draft: id ? toDraft(byId(id)) : null })
  history.replaceState(null, '', id ? `#${id}` : location.pathname) // so a reload comes back to the same opening
  renderList()
  renderEditor()
}

/** A blank opening following from `parentId`: its moves started, and the colour that plays next. */
function startNew(parentId) {
  if (!leaveOk()) return
  const parent = byId(parentId) ?? state.openings.find((o) => o.parent === null)
  const plies = parent.moves ? parent.moves.split(' ').length : 0
  Object.assign(state, { selected: null, isNew: true, dirty: false, message: null,
    draft: { id: '', parent: parent.id, name: '', aliases: '', side: plies % 2 ? 'b' : 'w', moves: parent.moves ? `${parent.moves} ` : '', eco: '', target: '', blurb: '', history: '', ideas: [], extra: [] } })
  renderList()
  renderEditor()
  document.querySelector('#editor input')?.focus()
}

let previewTimer
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, 250)
}

const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
function board(fen) {
  const squares = []
  fen.split(' ')[0].split('/').forEach((rank, r) => {
    let file = 0
    for (const ch of rank) {
      const run = Number(ch) || 1
      for (let i = 0; i < run; i++, file++) squares.push(h('i', { class: (r + file) % 2 ? 'd' : '' }, Number(ch) ? '' : GLYPH[ch]))
    }
  })
  return h('div', { class: 'board', role: 'img', 'aria-label': 'The position after these moves' }, squares)
}

/** Under the moves: the position, whether the line is legal and new, and how often recent games reach it. */
async function renderPreview() {
  const box = document.getElementById('preview')
  const draft = state.draft
  if (!box || !draft) return
  let p
  try {
    p = await api('POST', '/api/preview', { moves: draft.moves })
  } catch (err) {
    p = { error: err.message }
  }
  if (draft !== state.draft || !document.getElementById('preview')) return // another opening was chosen meanwhile
  const info = []
  if (p.error) info.push(h('p', { class: 'error' }, p.error))
  else {
    if (p.sameAs && p.sameAs.id !== state.selected) info.push(h('p', { class: 'error' }, `${p.sameAs.name} already has this position.`))
    if (p.reach.chesscom.of || p.reach.lichess.of) {
      info.push(h('p', {}, 'Reached in ', h('b', {}, percent(p.reach.chesscom)), ' of recent chess.com games and ', h('b', {}, percent(p.reach.lichess)), ' on Lichess.'))
      info.push(h('p', { class: 'muted small' }, `${reachTitle(p.reach.chesscom, 'chess.com')}; ${reachTitle(p.reach.lichess, 'Lichess')}.`))
    } else info.push(h('p', { class: 'muted' }, 'How often this is reached appears once the sample of recent games is in.'))
    const target = document.getElementById('target')
    if (target) target.placeholder = `${p.defaultTarget} (usual at this depth)`
  }
  box.replaceChildren(h('div', {}, info), p.fen ? board(p.fen) : '')
}

const CHECK_HELP = `One of
  { "play": "Nc6|Nf6" }               you play one of these moves
  { "setup": ["Nf6", "Be7", "O-O"] }  you play all of these; part credit for some
  { "avoid": "Q*" }                   you do not play any of these
  { "first": "N*", "then": "B*" }     the first comes before the second
with a time limit counted in your own moves
  "by": 10        by move 10 of the game
  "within": 2     within 2 moves of reaching the opening (or of the trigger)
and optionally a trigger
  "when": "d4 exd4 cxd4"   these plies in a row, the last played by your opponent
  "next": true             the trigger must come straight after the opening
"N*" is any non-capturing knight move, "castle" is either castling, "!d5" is anything except d5.
Leave the check empty for an idea that is only something to know.`

function renderEditor() {
  const el = document.getElementById('editor')
  const d = state.draft
  if (!d) {
    el.replaceChildren(h('p', { class: 'empty' }, 'Choose an opening to see and change its properties, or add a new one.'))
    return
  }
  const original = state.isNew ? null : byId(state.selected)
  const isRoot = original?.parent === null
  const touch = () => { state.dirty = true }
  const set = (key) => (e) => { d[key] = e.target.value; touch() }
  const field = (label, control, hint) => h('label', {}, h('span', {}, label), control, hint ? h('small', {}, hint) : null)

  // An opening cannot follow from itself or from anything beneath it.
  const beneath = new Set(original ? [original.id] : [])
  for (const { o } of mapOrder()) if (beneath.has(o.parent)) beneath.add(o.id)
  const parentSelect = h('select', { disabled: isRoot, onchange: set('parent') },
    isRoot ? h('option', { value: '' }, 'Nothing: this is where the map starts') : null,
    mapOrder().filter(({ o }) => !beneath.has(o.id)).map(({ o, level }) => h('option', { value: o.id, selected: o.id === d.parent }, `${'  '.repeat(level)}${o.name}`)))
  const sideSelect = h('select', { disabled: isRoot, onchange: set('side') },
    isRoot ? h('option', { value: '' }, 'Neither') : null,
    h('option', { value: 'w', selected: d.side === 'w' }, 'White'), h('option', { value: 'b', selected: d.side === 'b' }, 'Black'))

  const ideas = d.ideas.map((idea, i) => h('div', { class: 'idea' },
    h('textarea', { rows: 2, value: idea.text, 'aria-label': `Idea ${i + 1}`, placeholder: 'The idea, in a sentence', oninput: (e) => { idea.text = e.target.value; touch() } }),
    h('button', { class: 'danger', title: 'Remove this idea', onclick: () => { d.ideas.splice(i, 1); touch(); renderEditor() } }, 'Remove'),
    h('input', { value: idea.check, spellcheck: false, 'aria-label': `Check for idea ${i + 1}`, placeholder: 'Check, such as { "play": "Nc6|Nf6", "within": 2 }; empty for none', oninput: (e) => { idea.check = e.target.value; touch() } })))

  const extras = d.extra.map((x, i) => h('div', { class: 'extra' },
    h('input', { value: x.key, spellcheck: false, 'aria-label': 'Property name', placeholder: 'name', oninput: (e) => { x.key = e.target.value; touch() } }),
    h('input', { value: x.value, 'aria-label': 'Property value', placeholder: 'value', oninput: (e) => { x.value = e.target.value; touch() } }),
    h('button', { class: 'danger', onclick: () => { d.extra.splice(i, 1); touch(); renderEditor() } }, 'Remove')))

  el.replaceChildren(
    h('div', { class: 'titlebar' },
      h('div', {},
        h('h2', {}, state.isNew ? 'New opening' : original.name),
        h('p', { class: 'muted small' }, state.isNew ? 'Its permanent id is assigned when it is added.' : ['Permanent id ', h('code', {}, original.id), '. Progress is stored under it, so it never changes.'])),
      original && !isRoot ? h('button', { class: 'link', onclick: () => startNew(original.id) }, 'Add an opening after this one') : null),
    h('div', { class: 'grid' },
      field('Canonical name', h('input', { value: d.name, oninput: set('name') }), 'The name the app shows. It can change at any time without touching anyone’s progress.'),
      field('Also known as', h('textarea', { rows: 2, value: d.aliases, oninput: set('aliases'), placeholder: 'One name per line' }), 'Other names for the same opening: regional ones, older ones.'),
      field('Follows from', parentSelect),
      field('Mission for', sideSelect, 'The colour a player has when this is their mission.'),
      h('div', { class: 'wide line' },
        h('div', {},
          field('Moves', h('input', { class: 'mv', value: d.moves, disabled: isRoot, spellcheck: false, placeholder: 'e4 e5 Nf3', oninput: (e) => { set('moves')(e); schedulePreview() } }),
            'Every move from the start, without move numbers. They must begin with the moves of the opening this follows from.'),
          h('div', { class: 'grid', style: 'margin-top:12px' },
            field('ECO code', h('input', { value: d.eco, oninput: set('eco') })),
            field('Games to finish the mission', h('input', { id: 'target', type: 'number', min: 1, value: d.target, oninput: set('target') }), 'Empty uses the usual number.'))),
        h('div', { id: 'preview', class: 'small' })),
      h('div', { class: 'wide' }, field('Blurb', h('textarea', { rows: 2, value: d.blurb, oninput: set('blurb') }), 'One or two sentences shown at the top of the opening’s page.')),
      h('div', { class: 'wide' }, field('History', h('textarea', { rows: 7, value: d.history, oninput: set('history') }), 'Free-form: where the opening comes from and why it has its name. Blank lines separate paragraphs.'))),

    h('h3', {}, 'Ideas and their checks'),
    ...ideas,
    h('div', { class: 'idea' }, h('div', {}, h('button', { onclick: () => { d.ideas.push({ text: '', check: '' }); touch(); renderEditor(); [...el.querySelectorAll('.idea textarea')].at(-1)?.focus() } }, 'Add an idea'))),
    h('details', {}, h('summary', { class: 'small muted' }, 'How checks are written'), h('pre', {}, CHECK_HELP)),

    h('h3', {}, 'Other properties'),
    ...(extras.length ? extras : [h('p', { class: 'muted small', style: 'margin-bottom:8px' }, 'None. Anything added here is stored on the opening as it is.')]),
    h('button', { onclick: () => { d.extra.push({ key: '', value: '' }); touch(); renderEditor() } }, 'Add a property'),
    h('p', { class: 'hint' }, 'A value that reads as JSON (a number, true, a list) is stored as that; anything else is stored as text.'),

    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: save }, state.isNew ? 'Add opening' : 'Save'),
      h('button', { onclick: () => select(state.isNew ? null : state.selected) }, state.isNew ? 'Cancel' : 'Undo changes'),
      state.message ? h('span', { class: state.message.error ? 'error' : 'ok', role: 'status' }, state.message.text) : null,
      h('span', { class: 'spacer' }),
      original && !isRoot ? h('button', { class: 'danger', onclick: remove }, 'Delete opening') : null),
  )
  state.message = null
  renderPreview()
}

/** The form's values as the server expects them, or an Error naming the field that will not parse. */
function payload() {
  const d = state.draft
  const checks = d.ideas.map((idea, i) => {
    if (!idea.check.trim()) return null
    try {
      return JSON.parse(idea.check)
    } catch {
      throw new Error(`The check for idea ${i + 1} is not valid JSON.`)
    }
  })
  const extra = {}
  for (const { key, value } of d.extra) {
    if (!key.trim()) continue
    try {
      extra[key.trim()] = JSON.parse(value)
    } catch {
      extra[key.trim()] = value
    }
  }
  return { parent: d.parent || null, name: d.name, aliases: d.aliases.split('\n'), side: d.side || null, moves: d.moves, eco: d.eco, target: d.target, blurb: d.blurb, history: d.history, ideas: d.ideas.map((i) => i.text), checks, extra }
}

function apply(fresh) {
  state.openings = fresh.openings
  state.sample = fresh.sample
  state.recentDays = fresh.recentDays
}

async function save() {
  try {
    const body = payload()
    const fresh = state.isNew ? await api('POST', '/api/openings', body) : await api('PUT', `/api/openings/${encodeURIComponent(state.selected)}`, body)
    apply(fresh)
    state.message = { text: 'Saved to tree.json.' }
    select(fresh.id ?? state.selected, true)
  } catch (err) {
    state.message = { text: err.message, error: true }
    renderEditor()
  }
}

async function remove() {
  const o = byId(state.selected)
  const parent = byId(o.parent)
  const moved = o.children ? ` The ${o.children === 1 ? 'opening' : `${o.children} openings`} that follow from it will follow from ${parent.name} instead.` : ''
  if (!confirm(`Delete ${o.name}?${moved}`)) return
  try {
    apply(await api('DELETE', `/api/openings/${encodeURIComponent(o.id)}`))
    select(null, true)
  } catch (err) {
    state.message = { text: err.message, error: true }
    renderEditor()
  }
}

window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault() })

try {
  const fresh = await api('GET', '/api/tree')
  apply(fresh)
  document.getElementById('file').textContent = fresh.file
  renderSample()
  select(byId(location.hash.slice(1))?.id ?? null, true)
} catch (err) {
  document.getElementById('editor').replaceChildren(h('p', { class: 'error' }, err.message))
}

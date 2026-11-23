// Shared by every comp: sample data, the board, and the map's tree layout.
// Each comp page supplies its own markup and styles; nothing here decides how things look.
window.Comp = (() => {
  const fog = (side) => ({ fog: true, side, kids: [] })

  const tree = {
    id: 'start', name: 'Starting position', status: 'start', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
    kids: [
      {
        id: 'kp', name: "King's Pawn Opening", side: 'w', move: '1.e4', eco: 'B00', status: 'done', count: 10, target: 10,
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
        kids: [
          {
            id: 'open', name: 'Open Game', side: 'b', move: '1...e5', eco: 'C20', status: 'done', count: 8, target: 8,
            fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR',
            kids: [
              {
                id: 'knight', name: "King's Knight Opening", side: 'w', move: '2.Nf3', eco: 'C40', status: 'active', count: 4, target: 6,
                fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R',
                kids: [fog('b'), fog('b'), fog('b')],
              },
              fog('w'), fog('w'),
            ],
          },
          {
            id: 'sicilian', name: 'Sicilian Defense', side: 'b', move: '1...c5', eco: 'B20', status: 'active', count: 3, target: 8,
            fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR',
            kids: [fog('w'), fog('w')],
          },
          fog('b'), fog('b'), fog('b'),
        ],
      },
      fog('w'), fog('w'),
    ],
  }

  /** The opening shown on the strategy card. */
  const card = {
    id: 'knight', name: "King's Knight Opening", side: 'w', eco: 'C40', status: 'Active mission', count: 4, target: 6,
    moves: '1.e4 e5 2.Nf3', lastMove: '2.Nf3', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R',
    blurb: 'White develops a piece and attacks the e5 pawn at once. It is the main road into the Italian, the Ruy Lopez and the Scotch.',
    yourMoves: ['1.e4', '2.Nf3'], theirMoves: ['1...e5'],
    ideas: [
      { text: 'Nf3 develops with a threat, so Black must react.' },
      { text: 'It prepares short castling.' },
      { text: 'If Black defends badly, for example with ...f6, Nxe5 is often strong.', followed: 3, of: 4 },
    ],
    stats: { reached: 31, of: 212, pct: 15, win: 14, draw: 3, loss: 14, accuracy: 75, scored: 4 },
    elsewhere: [
      { move: '1...c5', count: 68 }, { move: '1...e6', count: 22 }, { move: '1...d5', count: 17 },
      { move: '1...c6', count: 12 }, { move: '2.Bc4', count: 9, mine: true },
    ],
    games: [
      { date: '22 Nov', opp: 'pawnstorm_88', rating: 1012, type: 'Rapid 10+0', result: 'Won' },
      { date: '21 Nov', opp: 'kasparov_not', rating: 987, type: 'Blitz 5+0', result: 'Lost' },
      { date: '19 Nov', opp: 'e4enjoyer', rating: 1041, type: 'Rapid 10+0', result: 'Won' },
      { date: '18 Nov', opp: 'quietmove', rating: 995, type: 'Blitz 3+2', result: 'Drawn' },
    ],
  }

  const missions = [
    { side: 'w', name: "King's Knight Opening", moves: '1.e4 e5 2.Nf3', count: 4, target: 6, reach: 'Reached in 8 of your last 50 White games' },
    { side: 'b', name: 'Sicilian Defense', moves: '1.e4 c5', count: 3, target: 8, reach: 'Reached in 11 of your last 50 Black games' },
  ]

  const latest = [
    { side: 'w', result: 'Won', opening: "King's Knight Opening", verdict: 'Counted 4/6' },
    { side: 'b', result: 'Lost', opening: 'undiscovered', verdict: 'Opponent left at 1.d4' },
    { side: 'w', result: 'Won', opening: 'Sicilian Defense', verdict: 'Opponent left at 1...c5' },
    { side: 'b', result: 'Drawn', opening: 'Sicilian Defense', verdict: 'Counted 3/8' },
  ]

  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }

  /** A board from the piece-placement part of a FEN, as the app draws it. `sq` is the square size in px. */
  function board(fen, { flip = false, sq = 14 } = {}) {
    const cells = []
    fen.split(' ')[0].split('/').forEach((row, r) => {
      let f = 0
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push({ r, f: f++, p: '' })
        else cells.push({ r, f: f++, p: ch })
      }
    })
    if (flip) cells.reverse()
    const sqs = cells.map((c) => {
      const white = c.p && c.p === c.p.toUpperCase()
      return `<i class="${(c.r + c.f) % 2 ? 'd' : ''} ${white ? 'w' : ''}">${c.p ? GLYPH[c.p.toLowerCase()] + '︎' : ''}</i>`
    })
    return `<div class="board" style="--sq:${sq}px" role="img" aria-label="Chess position">${sqs.join('')}</div>`
  }

  /**
   * Left-to-right tree, each parent centred on its children.
   * opts: { W, GAP_X, GAP_Y, height(item) } where height gives each tile's height.
   */
  function layout({ W, GAP_X, GAP_Y, height }) {
    const all = []
    const edges = []
    const wrap = (n) => ({ n, h: height(n), kids: n.kids.map(wrap) })
    const measure = (it) => {
      it.kidsH = it.kids.reduce((s, k) => s + measure(k), 0) + GAP_Y * Math.max(0, it.kids.length - 1)
      return (it.sub = Math.max(it.h, it.kidsH))
    }
    const place = (it, depth, top) => {
      it.x = depth * (W + GAP_X)
      let y = top + (it.sub - it.kidsH) / 2
      for (const k of it.kids) {
        place(k, depth + 1, y)
        y += k.sub + GAP_Y
      }
      if (it.kids.length) {
        const a = it.kids[0]
        const b = it.kids.at(-1)
        it.y = (a.y + a.h / 2 + b.y + b.h / 2) / 2 - it.h / 2
      } else {
        it.y = top + (it.sub - it.h) / 2
      }
      all.push(it)
      for (const k of it.kids) edges.push({ from: it, to: k })
    }
    const root = wrap(tree)
    measure(root)
    place(root, 0, 0)
    return { all, edges, width: Math.max(...all.map((i) => i.x)) + W, height: root.sub }
  }

  const PATHS = {
    curve: (x1, y1, x2, y2) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`,
    elbow: (x1, y1, x2, y2) => `M${x1} ${y1} H${(x1 + x2) / 2} V${y2} H${x2}`,
    // Horizontal, a 45 degree run, horizontal: the way a transit diagram turns.
    diag: (x1, y1, x2, y2) => {
      const dy = y2 - y1
      const run = Math.min(Math.abs(dy), x2 - x1 - 16)
      const sx = x1 + (x2 - x1 - run) / 2
      return `M${x1} ${y1} H${sx} L${sx + run} ${y1 + Math.sign(dy) * run} V${y2} H${x2}`
    },
    straight: (x1, y1, x2, y2) => `M${x1} ${y1} L${x2} ${y2}`,
  }

  /**
   * Draw the map into `el`. opts: layout options plus
   *   edge: 'curve' | 'elbow' | 'diag' | 'straight'
   *   node(n), fog(n): markup for a tile
   *   out(item), into(item): optional [dx, dy] of where an edge leaves or enters a tile, from its top-left
   */
  function map(el, opts) {
    const { all, edges, width, height } = layout(opts)
    const W = opts.W
    const out = opts.out ?? ((it) => [W, it.h / 2])
    const into = opts.into ?? ((it) => [0, it.h / 2])
    const path = PATHS[opts.edge ?? 'curve']
    const lines = edges.map(({ from, to }) => {
      const [ox, oy] = out(from)
      const [ix, iy] = into(to)
      const kind = to.n.fog ? 'fog' : to.n.status
      return `<path class="e ${kind} s-${to.n.side}" d="${path(from.x + ox, from.y + oy, to.x + ix, to.y + iy)}" fill="none" />`
    })
    const tiles = all.map((it) => {
      const cls = it.n.fog ? 'tile fogt' : `tile ${it.n.status}`
      return `<div class="${cls}" style="left:${it.x}px;top:${it.y}px;width:${W}px;height:${it.h}px">${it.n.fog ? opts.fog(it.n) : opts.node(it.n)}</div>`
    })
    el.innerHTML = `<div class="canvas" style="width:${width}px;height:${height}px">
      <svg width="${width}" height="${height}" aria-hidden="true">${lines.join('')}</svg>${tiles.join('')}</div>`
  }

  const sideName = (s) => (s === 'w' ? 'White' : 'Black')

  /** A small strip linking the comps to each other; the same on every page so it reads as outside the design. */
  function nav(current) {
    const pages = [['1-scoresheet', 'Scoresheet'], ['2-field-manual', 'Field manual'], ['3-chess-column', 'Chess column'], ['4-transit', 'Transit'], ['5-slate', 'Slate']]
    const bar = document.createElement('div')
    bar.style.cssText = 'font:12px/1 ui-monospace,Menlo,monospace;background:#111;color:#aaa;padding:9px 14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap'
    bar.innerHTML = `<a href="index.html" style="color:#fff;text-decoration:none">Rank and File comps</a>` + pages.map(([f, label], i) =>
      `<a href="${f}.html" style="color:${f === current ? '#fff' : '#aaa'};text-decoration:${f === current ? 'underline' : 'none'}">${i + 1}. ${label}</a>`).join('')
    document.body.prepend(bar)
  }

  return { tree, card, missions, latest, board, map, sideName, nav }
})()

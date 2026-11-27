// Loads data/tree.json and works out each opening's target position. Beside it,
// data/popularity.json says how often each opening is reached on chess.com.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'
import { compileCheck } from './checks.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TREE_FILE = path.join(ROOT, 'data', 'tree.json')

/** The popularity figures for a tree file are kept next to it. */
export const popularityFileFor = (treeFile) => path.join(path.dirname(treeFile), 'popularity.json')

/**
 * The file's `reached`: for each opening id, how many games of a sample of recent
 * chess.com games reached it. The openings editor writes the file (tools/openings/popularity.js).
 * Empty when there is no file yet.
 */
export function readPopularity(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
  return JSON.parse(text).reached ?? {}
}

/** Board, side to move and castling rights. Move counters and en passant are ignored so transpositions match. */
export function positionKey(fen) {
  return fen.split(' ').slice(0, 3).join(' ')
}

/** Games needed to complete a mission. Deeper lines depend more on the opponent, so they need fewer. */
export function targetFor(depth) {
  if (depth <= 1) return 10
  if (depth === 2) return 8
  if (depth <= 4) return 6
  if (depth <= 6) return 5
  if (depth <= 8) return 4
  return 3
}

/** `popularity` maps an opening's id to how many sampled chess.com games reached it; an opening it leaves out gets 0. */
export function buildTree(raw, popularity = {}) {
  const byId = new Map()
  const nodes = []
  for (const r of raw) {
    if (byId.has(r.id)) throw new Error(`tree: duplicate id "${r.id}"`)
    const plies = r.moves ? r.moves.trim().split(/\s+/) : []
    const chess = new Chess()
    const keys = [positionKey(chess.fen())]
    for (const san of plies) {
      try {
        chess.move(san)
      } catch {
        throw new Error(`tree: "${r.id}" has an illegal move "${san}" in "${r.moves}"`)
      }
      keys.push(positionKey(chess.fen()))
    }
    const ideas = r.ideas ?? []
    if (r.checks && r.checks.length !== ideas.length) throw new Error(`tree: "${r.id}" needs one check (or null) per idea`)
    const node = {
      ...r,
      // Each idea with its check; null when the idea is only something to know.
      advice: ideas.map((text, i) => ({ text, check: r.checks?.[i] ? compileCheck(r.checks[i], `tree: "${r.id}" check ${i + 1}`) : null })),
      plies,
      keys,
      key: keys.at(-1),
      fen: chess.fen(),
      depth: plies.length,
      target: r.target ?? targetFor(plies.length),
      popularity: popularity[r.id] ?? 0,
      children: [],
    }
    byId.set(r.id, node)
    nodes.push(node)
  }

  let root = null
  for (const n of nodes) {
    if (n.parent === null) {
      if (root) throw new Error('tree: more than one root')
      root = n
      continue
    }
    const parent = byId.get(n.parent)
    if (!parent) throw new Error(`tree: "${n.id}" has unknown parent "${n.parent}"`)
    if (!['w', 'b'].includes(n.side)) throw new Error(`tree: "${n.id}" needs side "w" or "b"`)
    if (n.depth <= parent.depth || parent.plies.some((p, i) => n.plies[i] !== p)) {
      throw new Error(`tree: "${n.id}" must extend the moves of its parent "${parent.id}"`)
    }
    parent.children.push(n)
  }
  if (!root) throw new Error('tree: no root node')

  const seen = new Map()
  for (const n of nodes) {
    if (seen.has(n.key)) throw new Error(`tree: "${n.id}" and "${seen.get(n.key)}" reach the same position`)
    seen.set(n.key, n.id)
  }
  return { nodes, byId, root }
}

export function loadTree(file = TREE_FILE) {
  return buildTree(JSON.parse(fs.readFileSync(file, 'utf8')), readPopularity(popularityFileFor(file)))
}

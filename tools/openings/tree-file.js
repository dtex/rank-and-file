// Reads, changes and writes data/tree.json for the openings editor. Every change is
// checked with the same buildTree() the app uses before anything reaches the disk.
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { TREE_FILE, buildTree } from '../../services/tree.js'

/** Properties the editor knows, in the order they are written. Anything else is kept and written last. */
const HEAD = ['id', 'parent', 'name', 'side', 'moves', 'eco', 'target']
const BODY = ['aliases', 'blurb', 'history', 'ideas', 'checks']
export const KNOWN = [...HEAD, ...BODY]

/** An error whose message is meant for the person using the editor. */
export class EditError extends Error {}

/** JSON on one line, spaced the way tree.json is written by hand: { "a": 1 } and ["a", "b"]. */
function inline(value) {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  if (value && typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`)
    return parts.length ? `{ ${parts.join(', ')} }` : '{}'
  }
  return JSON.stringify(value)
}

/** The whole file as text: one opening per paragraph, short properties on its first line. */
export function formatTree(raw) {
  const blocks = raw.map((node) => {
    const prop = (k) => `${JSON.stringify(k)}: ${inline(node[k])}`
    const head = HEAD.filter((k) => k in node).map(prop).join(', ')
    const rest = [...BODY.filter((k) => k in node), ...Object.keys(node).filter((k) => !KNOWN.includes(k))]
    return `  { ${[head, ...rest.map(prop)].join(',\n    ')} }`
  })
  return `[\n${blocks.join(',\n\n')}\n]\n`
}

export function readTree(file = TREE_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Validate, then replace the file in one step so a crash cannot leave half of it. */
export function writeTree(raw, file = TREE_FILE) {
  validate(raw)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, formatTree(raw))
  fs.renameSync(tmp, file)
}

/** The built tree, or an EditError saying what is wrong in the app's own words. */
export function validate(raw) {
  let tree
  try {
    tree = buildTree(raw)
  } catch (err) {
    throw new EditError(err.message.replace(/^tree: /, ''))
  }
  // A canonical name belongs to one opening. Aliases may repeat: one name is often used for several lines.
  const named = new Map()
  for (const r of raw) {
    const key = r.name.toLowerCase()
    if (named.has(key)) throw new EditError(`Two openings are called "${r.name}". Give one of them another name; the other name can be an alias.`)
    named.set(key, r.id)
  }
  return tree
}

/**
 * A permanent id for a new opening. It is made up, not taken from the name, because
 * players' progress is stored under it and the name has to stay free to change.
 */
export function newId(raw) {
  const taken = new Set(raw.map((n) => n.id))
  for (;;) {
    // Eight characters without look-alikes (no 0/o, 1/l), starting with a letter.
    const letters = 'abcdefghjkmnpqrstuvwxyz'
    const all = `${letters}23456789`
    const bytes = randomBytes(8)
    const id = letters[bytes[0] % letters.length] + [...bytes.subarray(1)].map((b) => all[b % all.length]).join('')
    if (!taken.has(id)) return id
  }
}

const text = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Tidy what the form sent into the record that is stored under `id`: trimmed text,
 * optional properties left out when empty, and one check (or null) per idea.
 * The id never comes from the form.
 */
export function clean(input, id) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EditError('Expected an opening.')
  const name = text(input.name)
  if (!name) throw new EditError('Give the opening a name.')
  const node = { id, parent: text(input.parent) || null, name, side: ['w', 'b'].includes(input.side) ? input.side : null, moves: text(input.moves).replace(/\s+/g, ' ') }

  // Other names for the same opening, without repeats and without the canonical name itself.
  const aliases = []
  for (const alias of Array.isArray(input.aliases) ? input.aliases.map(text) : []) {
    const known = [name, ...aliases].some((n) => n.toLowerCase() === alias.toLowerCase())
    if (alias && !known) aliases.push(alias)
  }
  if (aliases.length) node.aliases = aliases

  const eco = text(input.eco)
  if (eco) node.eco = eco
  if (input.target !== undefined && input.target !== null && input.target !== '') {
    const target = Number(input.target)
    if (!Number.isInteger(target) || target < 1) throw new EditError('The target is a whole number of games, or empty to use the usual one for the depth.')
    node.target = target
  }
  for (const k of ['blurb', 'history']) {
    // History is free-form, so its paragraphs are kept; only the ends are trimmed.
    const value = k === 'history' ? String(input[k] ?? '').replace(/\r\n/g, '\n').trim() : text(input[k])
    if (value) node[k] = value
  }

  const ideas = Array.isArray(input.ideas) ? input.ideas : []
  const checks = Array.isArray(input.checks) ? input.checks : []
  const rows = ideas.map((idea, i) => ({ idea: text(idea), check: checks[i] ?? null })).filter((r) => r.idea)
  if (ideas.some((idea, i) => !text(idea) && checks[i])) throw new EditError('A check needs an idea to belong to. Write the idea, or remove the check.')
  if (rows.length) {
    node.ideas = rows.map((r) => r.idea)
    node.checks = rows.map((r) => r.check)
  }

  for (const [k, v] of Object.entries(input.extra ?? {})) {
    const key = k.trim()
    if (!key) continue
    if (KNOWN.includes(key) || key === 'extra') throw new EditError(`"${key}" has its own field above; it cannot also be an extra property.`)
    node[key] = v
  }
  return node
}

/** Where a new opening goes in the file: straight after the last opening beneath its parent. */
function insertIndex(raw, parentId) {
  const inSubtree = new Set([parentId])
  let last = raw.findIndex((n) => n.id === parentId)
  raw.forEach((n, i) => {
    if (!inSubtree.has(n.parent)) return
    inSubtree.add(n.id)
    last = Math.max(last, i)
  })
  return last + 1
}

/** A new tree with the opening added under `id`, which is made up unless one is given. */
export function addOpening(raw, input, id = newId(raw)) {
  if (raw.some((n) => n.id === id)) throw new EditError(`There is already an opening with the id "${id}".`)
  const node = clean(input, id)
  if (!node.parent) throw new EditError('Choose the opening this one follows from.')
  if (!raw.some((n) => n.id === node.parent)) throw new EditError(`There is no opening with the id "${node.parent}".`)
  const next = [...raw]
  next.splice(insertIndex(raw, node.parent), 0, node)
  validate(next)
  return next
}

/** A new tree with the opening `id` replaced. Everything about it can change except the id. */
export function updateOpening(raw, id, input) {
  const at = raw.findIndex((n) => n.id === id)
  if (at < 0) throw new EditError(`There is no opening with the id "${id}".`)
  const isRoot = raw[at].parent === null
  const node = clean(input, id)
  if (isRoot) {
    if (node.parent || node.moves) throw new EditError('The starting position has no parent and no moves.')
  } else if (!node.parent) {
    throw new EditError('Choose the opening this one follows from.')
  }
  const next = raw.map((n, i) => (i === at ? node : n))
  validate(next)
  return next
}

/** A new tree without the opening `id`. Openings beneath it move up to its parent. */
export function deleteOpening(raw, id) {
  const node = raw.find((n) => n.id === id)
  if (!node) throw new EditError(`There is no opening with the id "${id}".`)
  if (node.parent === null) throw new EditError('The starting position cannot be deleted.')
  const next = raw.filter((n) => n.id !== id).map((n) => (n.parent === id ? { ...n, parent: node.parent } : n))
  validate(next)
  return next
}

// Writes data/popularity.json: how many games of the chess.com sample reached each
// opening. The app reads it to decide which opening a player uncovers next
// (services/missions.js, nextOpening). The editor calls this whenever the map or the
// chess.com sample changes; "npm run popularity" writes it from the sample on disk.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TREE_FILE, popularityFileFor } from '../../services/tree.js'
import { readTree, validate } from './tree-file.js'
import { Sample } from './sample.js'

/**
 * Write the figures for the map in `treeFile` next to it, one opening a line in map
 * order. Returns the file written, or null when there is no chess.com sample, in
 * which case the figures already on disk are left as they are.
 */
export function writePopularity(sample, treeFile = TREE_FILE) {
  const { games, fetchedAt } = sample.sites.chesscom
  if (!games.length) return null
  const counts = sample.countsFor('chesscom')
  const tree = validate(readTree(treeFile))
  const reached = tree.nodes.filter((n) => n !== tree.root).map((n) => `    ${JSON.stringify(n.id)}: ${counts.get(n.key) ?? 0}`)
  const file = popularityFileFor(treeFile)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `{\n  "site": "chess.com",\n  "sampledAt": ${JSON.stringify(fetchedAt)},\n  "games": ${games.length},\n  "reached": {\n${reached.join(',\n')}\n  }\n}\n`)
  fs.renameSync(tmp, file)
  return file
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = writePopularity(new Sample())
  if (!file) {
    console.error('There is no chess.com sample yet. Run "npm run openings" and let it gather one first.')
    process.exit(1)
  }
  console.log(`Wrote ${file}`)
}

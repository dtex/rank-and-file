// Validates data/tree.json and prints the flowchart. Run after editing the tree.
import { loadTree } from '../services/tree.js'

const tree = loadTree()
const print = (node, indent) => {
  const side = node.side === 'w' ? 'White' : node.side === 'b' ? 'Black' : '     '
  console.log(`${indent}${node.name}  [${side}${node.depth ? `, ${node.target} games` : ''}]  ${node.moves}`)
  for (const c of node.children) print(c, indent + '  ')
}
print(tree.root, '')
const missing = tree.nodes.filter((n) => n.depth && (!n.blurb || !n.ideas?.length)).map((n) => n.id)
console.log(`\n${tree.nodes.length - 1} openings, all lines legal.`)
if (missing.length) console.log(`Missing study notes: ${missing.join(', ')}`)

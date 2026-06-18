// Ingest one or more product-sales report CSVs into the guests table (CLI).
//
// The ticketing platform exports SEPARATE reports — a full ticket report plus
// one report per merch product. A buyer can appear in several files, and merch
// is often a standalone order with no ticket. The shared core (scripts/lib/
// ingest-core.mjs) dedupes orders by reference, separates tickets from merch,
// aggregates per buyer, and upserts WITHOUT touching check-in state.
//
// Usage:  node scripts/ingest_sales.mjs [inputDir]   (defaults to "data/sales-reports")
//   Put the full Selar sales exports in that folder (it is git-ignored — never
//   web-served), then run this. Always use COMPLETE exports, not partial deltas.
//
// In production you can instead use the in-app admin "Import Sales" button,
// which runs the same logic against the live database.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { importSales } from './lib/ingest-core.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const inputDir = join(root, process.argv[2] || 'data/sales-reports')
const dbPath = join(root, 'data', 'product-sales.sqlite')

const files = readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.csv'))
if (files.length === 0) {
  console.error(`No CSV files found in ${inputDir}`)
  process.exit(1)
}

const texts = files.map((file) => readFileSync(join(inputDir, file), 'utf8'))

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000;')

let summary
try {
  summary = importSales(db, texts)
} catch (error) {
  console.error('Ingestion failed, rolled back:', error)
  process.exit(1)
}

console.log(`Files: ${files.join(', ')}`)
console.log(`Orders (deduped): ${summary.orders} | Guests: ${summary.guests} | updated ${summary.updated}, inserted ${summary.inserted}`)
console.log('Ticket types:', summary.tiers.map((t) => `${t.tier}=${t.count}`).join(', '))
console.log(`Merch (${summary.merch.length}):`)
for (const g of summary.merch) {
  console.log(`  ${g.name} [${g.ticket_type || 'no ticket'}]: ${g.items || '—'}`)
}
if (summary.orphans.length) {
  console.log('WARNING — DB rows not in CSV (merch cleared, otherwise left as-is):', summary.orphans)
}

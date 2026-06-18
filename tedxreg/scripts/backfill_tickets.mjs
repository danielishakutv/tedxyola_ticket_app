import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const csvPath = join(__dirname, '..', 'data', 'productSales.csv')
const dbPath = join(__dirname, '..', 'data', 'product-sales.sqlite')

const db = new DatabaseSync(dbPath)

function parseCSVRow(row) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    const next = row[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') { current += '"'; i++ } else { inQuotes = !inQuotes }
    } else if (char === ',' && !inQuotes) { fields.push(current); current = '' } else { current += char }
  }
  fields.push(current)
  return { products: fields[0] || '', email: (fields[2] || '').trim().toLowerCase(), variables: fields[15] || '' }
}

function parseTicket(variables) {
  const text = variables || ''
  const match = text.match(/(Spark|Ember|Blaze)/i)
  const type = match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : ''
  const qtyMatch = text.match(/:(\d+)\s*$/)
  const quantity = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1
  return { type, quantity }
}

const csv = readFileSync(csvPath, 'utf8')
const lines = csv.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(1)

const update = db.prepare('UPDATE guests SET ticket_type = ?, quantity = ?, merch = ? WHERE email = ?')

let updated = 0
db.exec('BEGIN IMMEDIATE')
try {
  for (const line of lines) {
    const { products, email, variables } = parseCSVRow(line)
    if (!email) continue
    const { type, quantity } = parseTicket(variables)
    const merch = /t-?shirt|face\s*cap|hoodie|branded/i.test(products) ? 1 : 0
    const result = update.run(type, quantity, merch, email)
    if (result.changes > 0) updated += 1
  }
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('Backfill failed:', err)
  process.exit(1)
}

console.log(`Backfilled ${updated} rows.`)

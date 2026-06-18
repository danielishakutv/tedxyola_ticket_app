import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const csvPath = join(__dirname, '..', 'data', 'productSales.csv')
const dbPath = join(__dirname, '..', 'data', 'product-sales.sqlite')

mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    ref_code TEXT,
    ticket_type TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    total REAL,
    checked_in INTEGER NOT NULL DEFAULT 0,
    merch INTEGER NOT NULL DEFAULT 0,
    merch_checked_in INTEGER NOT NULL DEFAULT 0,
    checked_in_at TEXT,
    merch_checked_in_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

// Map a Variables cell like "Ember (Premium Experience):2" to { type, quantity }.
function parseTicket(variables) {
  const text = variables || ''
  const match = text.match(/(Spark|Ember|Blaze)/i)
  const type = match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : ''
  const qtyMatch = text.match(/:(\d+)\s*$/)
  const quantity = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1
  return { type, quantity }
}

function parseCSVRow(row) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    const next = row[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)

  return {
    products: fields[0] || '',
    fullname: fields[1] || '',
    email: fields[2] || '',
    mobile: fields[3] || '',
    address: fields[4] || '',
    reference: fields[5] || '',
    transaction_date: fields[6] || '',
    currency: fields[7] || '',
    total: fields[8] || '',
    coupon_discount: fields[9] || '',
    affiliate_commission: fields[10] || '',
    affiliate_email: fields[11] || '',
    affiliate_name: fields[12] || '',
    profit: fields[13] || '',
    payout: fields[14] || '',
    variables: fields[15] || '',
  }
}

function normalizeName(v) {
  return (v || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

let codeCounter = 1000
function generateCode() {
  codeCounter += 1
  return String(codeCounter).slice(-4)
}

let csv = ''
try {
  csv = readFileSync(csvPath, 'utf8')
} catch (err) {
  console.error(`Could not read CSV: ${csvPath}`)
  process.exit(1)
}

const lines = csv.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
if (lines.length <= 1) {
  console.error('CSV appears empty or only has header')
  process.exit(1)
}

const rows = lines.slice(1)

const insert = db.prepare(`
  INSERT INTO guests (name, normalized_name, email, phone, code, ref_code, ticket_type, quantity, total, checked_in, merch, merch_checked_in)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
`)
const mergeDuplicate = db.prepare(`
  UPDATE guests
  SET quantity = quantity + ?,
      total = COALESCE(total, 0) + ?,
      merch = MAX(merch, ?)
  WHERE email = ?
`)

db.exec('BEGIN IMMEDIATE')
let inserted = 0
let merged = 0
let skipped = 0
try {
  for (const row of rows) {
    const parsed = parseCSVRow(row)
    const email = (parsed.email || '').trim()
    if (!email) {
      skipped += 1
      continue
    }

    const { type: ticketType, quantity } = parseTicket(parsed.variables)
    // Merch is bundled when the purchased product line lists branded items.
    const merch = /t-?shirt|face\s*cap|hoodie|branded/i.test(parsed.products || '') ? 1 : 0
    const total = parseFloat(parsed.total) || 0

    // Same email = same buyer with another order; fold the extra tickets in.
    const exists = db.prepare('SELECT COUNT(*) AS c FROM guests WHERE email = ?').get(email).c
    if (exists) {
      mergeDuplicate.run(quantity, total, merch, email)
      merged += 1
      continue
    }

    const name = parsed.fullname || ''
    const normalized = normalizeName(name)
    const phone = parsed.mobile || ''
    const code = generateCode()
    const ref = parsed.reference || ''

    insert.run(name, normalized, email, phone, code, ref, ticketType, quantity, total, merch)
    inserted += 1
  }
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('Failed to import CSV:', err)
  process.exit(1)
}

console.log(`Imported ${inserted} rows; merged ${merged} duplicate-email orders; skipped ${skipped} rows. DB written to ${dbPath}`)

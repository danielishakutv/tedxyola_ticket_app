// Shared sales-ingest logic, used by both the CLI script (scripts/ingest_sales.mjs)
// and the in-app admin import endpoint (POST /api/admin/import).
//
// importSales(db, csvTexts) takes raw CSV strings (full Selar exports), and
// upserts guests into the given SQLite database. It is NON-DESTRUCTIVE for
// check-in state: it only writes ticket/merch fields, never checked_in,
// checked_in_count, admissions, or merch_checked_in.
//
// IMPORTANT: always pass COMPLETE exports, not partial deltas — merch is
// re-derived from the files, so a partial file would wrongly clear merch for
// anyone not in it.

const MERCH_RE = /t-?shirt|face\s*cap|hoodie|branded/i
const TIER_RE = /(Spark|Ember|Blaze)/i
const TIER_RANK = { Spark: 1, Ember: 2, Blaze: 3 }

// Column positions in the platform's export.
const COL = { products: 0, name: 1, email: 2, mobile: 3, reference: 5, date: 6, total: 8, variables: 15 }

// Full CSV parser: respects quotes, escaped quotes, and commas/newlines in fields.
export function parseCSV(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i += 1 }
      else if (char === '"') { inQuotes = false }
      else { field += char }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field); field = ''
    } else if (char === '\r') {
      // ignore
    } else if (char === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function titleTier(value) {
  return value[0].toUpperCase() + value.slice(1).toLowerCase()
}

function normalizeName(value) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Turn one order line into { tier, isTicket, qty, hasMerch }.
function classify(products, variables) {
  const tierMatch = (variables || '').match(TIER_RE)
  const tier = tierMatch ? titleTier(tierMatch[1]) : ''
  const isTicket = /tedxyola ticket/i.test(products || '') || Boolean(tierMatch)
  const qtyMatch = (variables || '').match(/:(\d+)\s*$/)
  const qty = isTicket ? (qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1) : 0
  const hasMerch = MERCH_RE.test(products || '')
  return { tier, isTicket, qty, hasMerch }
}

// Pull the branded items out of a products string into clean labels.
function merchItemsFromProducts(products) {
  return (products || '')
    .split(/,|&/)
    .map((part) => part.trim())
    .filter((part) => MERCH_RE.test(part) && !/ticket/i.test(part))
    .map((part) => part.replace(/tedxyola/ig, '').replace(/branded/ig, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// Aggregate raw CSV exports into one record per buyer.
export function aggregateGuests(csvTexts) {
  const orders = new Map()
  for (const text of csvTexts) {
    const rows = parseCSV(text)
    for (let r = 1; r < rows.length; r += 1) {
      const fields = rows[r]
      if (!fields || fields.length < 6) continue
      const email = (fields[COL.email] || '').trim().toLowerCase()
      if (!email) continue
      const reference = (fields[COL.reference] || '').trim()
      const key = reference || `${email}|${fields[COL.date] || ''}|${fields[COL.products] || ''}`
      if (orders.has(key)) continue // same order repeated across per-product reports
      orders.set(key, {
        products: fields[COL.products] || '',
        name: (fields[COL.name] || '').trim(),
        email,
        mobile: (fields[COL.mobile] || '').trim(),
        reference,
        total: parseFloat(fields[COL.total]) || 0,
        variables: fields[COL.variables] || '',
      })
    }
  }

  const guests = new Map()
  for (const order of orders.values()) {
    const info = classify(order.products, order.variables)
    let guest = guests.get(order.email)
    if (!guest) {
      guest = { name: order.name, email: order.email, phone: order.mobile, reference: '', ticket_type: '', quantity: 0, merch: 0, total: 0, merchItems: new Map() }
      guests.set(order.email, guest)
    }

    if (info.isTicket) {
      if (order.name) guest.name = order.name
      if (order.mobile) guest.phone = order.mobile
      if (!guest.reference) guest.reference = order.reference
      if (info.tier && (TIER_RANK[info.tier] || 0) > (TIER_RANK[guest.ticket_type] || 0)) {
        guest.ticket_type = info.tier
      }
      guest.quantity += info.qty
    } else {
      if (!guest.name) guest.name = order.name
      if (!guest.phone) guest.phone = order.mobile
      if (!guest.reference) guest.reference = order.reference
    }

    if (info.hasMerch) guest.merch = 1
    for (const itemName of merchItemsFromProducts(order.products)) {
      guest.merchItems.set(itemName, (guest.merchItems.get(itemName) || 0) + 1)
    }
    guest.total += order.total
  }

  return { orderCount: orders.size, guests }
}

// Upsert aggregated guests into the database (non-destructive to check-in state).
export function importSales(db, csvTexts) {
  const columns = db.prepare('PRAGMA table_info(guests)').all().map((c) => c.name)
  if (!columns.includes('merch_items')) {
    db.exec('ALTER TABLE guests ADD COLUMN merch_items TEXT')
  }

  const { orderCount, guests } = aggregateGuests(csvTexts)
  const dbEmails = new Set(db.prepare('SELECT email FROM guests').all().map((r) => r.email.trim().toLowerCase()))
  const orphans = [...dbEmails].filter((e) => !guests.has(e))

  const maxCode = db.prepare('SELECT COALESCE(MAX(CAST(code AS INTEGER)), 1000) AS m FROM guests').get().m
  let nextCode = Math.max(1000, Number(maxCode))
  const codeExists = db.prepare('SELECT 1 FROM guests WHERE code = ?')
  function freeCode() {
    let candidate
    do { nextCode += 1; candidate = String(nextCode) } while (codeExists.get(candidate))
    return candidate
  }

  const update = db.prepare(`
    UPDATE guests
    SET ticket_type = ?, quantity = ?, total = ?, merch = ?, merch_items = ?,
        phone = COALESCE(NULLIF(?, ''), phone), ref_code = COALESCE(NULLIF(?, ''), ref_code),
        updated_at = CURRENT_TIMESTAMP
    WHERE email = ?
  `)
  const insert = db.prepare(`
    INSERT INTO guests (name, normalized_name, email, phone, code, ref_code, ticket_type, quantity, total, checked_in, merch, merch_checked_in, merch_items)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)
  `)

  let updated = 0
  let inserted = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('UPDATE guests SET merch = 0, merch_items = NULL') // clear before re-applying from files
    for (const guest of guests.values()) {
      const ticketType = guest.ticket_type || null
      const merchItems = guest.merchItems.size
        ? JSON.stringify([...guest.merchItems].map(([item, qty]) => ({ item, qty })))
        : null
      const result = update.run(ticketType, guest.quantity, guest.total, guest.merch, merchItems, guest.phone, guest.reference, guest.email)
      if (result.changes > 0) {
        updated += 1
      } else {
        insert.run(guest.name, normalizeName(guest.name), guest.email, guest.phone, freeCode(), guest.reference || null, ticketType, guest.quantity, guest.total, guest.merch, merchItems)
        inserted += 1
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const merchList = db.prepare('SELECT name, ticket_type, merch_items FROM guests WHERE merch = 1 ORDER BY name').all()
    .map((g) => ({
      name: g.name,
      ticket_type: g.ticket_type,
      items: g.merch_items ? JSON.parse(g.merch_items).map((m) => `${m.item}${m.qty > 1 ? ` x${m.qty}` : ''}`).join(', ') : '',
    }))
  const tiers = db.prepare("SELECT COALESCE(NULLIF(ticket_type, ''), '(none)') AS tier, COUNT(*) AS count FROM guests GROUP BY tier ORDER BY count DESC").all()

  return { orders: orderCount, guests: guests.size, updated, inserted, orphans, merch: merchList, tiers }
}

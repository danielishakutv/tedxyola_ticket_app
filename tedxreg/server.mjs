import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import { importSales } from './scripts/lib/ingest-core.mjs'

const PORT = Number(process.env.PORT || 8787)
const __dirname = dirname(fileURLToPath(import.meta.url))
// DATA_DIR lets the database live on a persistent volume in production so that
// deploys never overwrite live check-in data. Defaults to the local ./data.
const dataDir = process.env.DATA_DIR || join(__dirname, 'data')
const dbPath = join(dataDir, 'product-sales.sqlite')
const seedDbPath = join(__dirname, 'data', 'product-sales.sqlite')
const distDir = join(__dirname, 'dist')

mkdirSync(dataDir, { recursive: true })

// Stateless signed tokens (survive restarts, no in-memory session store). The
// secret is persisted so logins stay valid across deploys/restarts.
const sessionSecretPath = join(dataDir, '.session-secret')
let sessionSecret = process.env.SESSION_SECRET || ''
if (!sessionSecret) {
  if (existsSync(sessionSecretPath)) {
    sessionSecret = readFileSync(sessionSecretPath, 'utf8').trim()
  } else {
    sessionSecret = crypto.randomBytes(32).toString('hex')
    writeFileSync(sessionSecretPath, sessionSecret, { mode: 0o600 })
  }
}

// First boot on a fresh volume: seed it from the bundled DB so we start with
// real data instead of an empty table. Existing volume data is left untouched.
if (!existsSync(dbPath) && existsSync(seedDbPath) && normalize(dbPath) !== normalize(seedDbPath)) {
  copyFileSync(seedDbPath, dbPath)
}

const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

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
    address TEXT,
    products TEXT,
    transaction_date TEXT,
    currency TEXT,
    total REAL,
    coupon_discount REAL,
    affiliate_commission REAL,
    affiliate_email TEXT,
    affiliate_name TEXT,
    profit REAL,
    payout REAL,
    variables TEXT,
    checked_in INTEGER NOT NULL DEFAULT 0,
    checked_in_count INTEGER NOT NULL DEFAULT 0,
    admissions TEXT,
    merch INTEGER NOT NULL DEFAULT 0,
    merch_items TEXT,
    merch_checked_in INTEGER NOT NULL DEFAULT 0,
    checked_in_at TEXT,
    merch_checked_in_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

ensureGuestSchema()

db.exec(`
  CREATE INDEX IF NOT EXISTS guests_normalized_name_idx ON guests(normalized_name);
  CREATE INDEX IF NOT EXISTS guests_code_idx ON guests(code);
  CREATE INDEX IF NOT EXISTS guests_ref_code_idx ON guests(ref_code);
  CREATE INDEX IF NOT EXISTS guests_phone_idx ON guests(phone);
  CREATE INDEX IF NOT EXISTS guests_checked_in_idx ON guests(checked_in);
  CREATE INDEX IF NOT EXISTS guests_merch_idx ON guests(merch);
  CREATE INDEX IF NOT EXISTS guests_merch_checked_in_idx ON guests(merch_checked_in);
`)

// Staff accounts (created by scripts/create_users.mjs) and the accountability log.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    guest_id INTEGER,
    guest_name TEXT,
    guest_code TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log(ts);
`)

const userByName = db.prepare('SELECT username, display_name, role, password_hash, salt FROM users WHERE username = ?')
const insertAuditStatement = db.prepare(`
  INSERT INTO audit_log (actor, action, guest_id, guest_name, guest_code, detail)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const auditExportStatement = db.prepare('SELECT ts, actor, action, guest_name, guest_code, detail FROM audit_log ORDER BY id')

// Mock seeding is opt-in (local demos only) so a fresh production DB never fills
// with 520 fake guests. Real data comes from the seed copy or `import:reports`.
const count = db.prepare('SELECT COUNT(*) AS total FROM guests').get().total
if (process.env.SEED_MOCK === 'true') {
  if (count === 0) {
    seedGuests()
  } else if (count === 520) {
    seedMockMerchEntitlements()
  }
}

const searchStatement = db.prepare(`
  SELECT id, name, email, phone, code, ref_code, ticket_type, quantity, total, checked_in, checked_in_count, admissions, merch, merch_items, merch_checked_in, checked_in_at, merch_checked_in_at
  FROM guests
  WHERE normalized_name LIKE ?
     OR code LIKE ?
     OR ref_code LIKE ?
     OR phone LIKE ?
  ORDER BY
    CASE
      WHEN normalized_name = ? THEN 0
      WHEN normalized_name LIKE ? THEN 1
      WHEN normalized_name LIKE ? THEN 2
      ELSE 3
    END,
    normalized_name
  LIMIT 30
`)

const guestStatement = db.prepare(`
  SELECT id, name, email, phone, code, ref_code, ticket_type, quantity, total, checked_in, checked_in_count, admissions, merch, merch_items, merch_checked_in, checked_in_at, merch_checked_in_at
  FROM guests
  WHERE id = ?
`)

const TICKET_TYPES = {
  Spark: 5500,
  Ember: 12000,
  Blaze: 20000,
}

const insertGuestStatement = db.prepare(`
  INSERT INTO guests (name, normalized_name, email, phone, code, ref_code, ticket_type, quantity, total, checked_in, merch, merch_checked_in, merch_items)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)
`)

// Merch items that can be added on the Quick Register form.
const REGISTER_MERCH = ['Face Cap', 'T-Shirt', 'Tote Bag']

const emailExistsStatement = db.prepare('SELECT id FROM guests WHERE email = ?')

const statsStatement = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(checked_in_count) AS checkedIn,
    SUM(quantity) AS seats,
    SUM(merch) AS merchEligible,
    SUM(merch_checked_in) AS merchDone
  FROM guests
`)

// Breakdown of how many tickets of each tier were bought (plus merch-only guests).
const ticketTypeStatement = db.prepare(`
  SELECT
    COALESCE(NULLIF(ticket_type, ''), 'None') AS tier,
    COUNT(*) AS guests,
    SUM(quantity) AS tickets
  FROM guests
  GROUP BY tier
`)

// Counter-based entry: tracks how many of an order's seats have been admitted,
// plus an optional admission log (name + time) so companions can arrive later.
const setEntryStatement = db.prepare(`
  UPDATE guests
  SET checked_in = ?,
      checked_in_count = ?,
      checked_in_at = ?,
      admissions = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const merchCheckInStatement = db.prepare(`
  UPDATE guests
  SET merch_checked_in = 1,
      merch_checked_in_at = COALESCE(merch_checked_in_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND merch = 1
`)

const merchUndoStatement = db.prepare(`
  UPDATE guests
  SET merch_checked_in = 0,
      merch_checked_in_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// Sell a ticket at the gate: set the tier if the guest had none, add a seat,
// and add the price to their total. Used for merch-only / walk-up buyers.
const sellTicketStatement = db.prepare(`
  UPDATE guests
  SET ticket_type = COALESCE(NULLIF(ticket_type, ''), ?),
      quantity = quantity + 1,
      total = COALESCE(total, 0) + ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const ROSTER_PAGE_SIZE = 50
const ROSTER_FILTERS = {
  all: '',
  'entry-pending': 'WHERE checked_in = 0',
  'entry-done': 'WHERE checked_in = 1',
  multi: 'WHERE quantity > 1',
  partial: 'WHERE checked_in_count > 0 AND checked_in_count < quantity',
  'merch-pending': 'WHERE merch = 1 AND merch_checked_in = 0',
}
const rosterStatements = Object.fromEntries(
  Object.entries(ROSTER_FILTERS).map(([key, where]) => [
    key,
    {
      page: db.prepare(`
        SELECT id, name, email, phone, code, ref_code, ticket_type, quantity, checked_in, checked_in_count, admissions, merch, merch_items, merch_checked_in, checked_in_at, merch_checked_in_at
        FROM guests
        ${where}
        ORDER BY normalized_name
        LIMIT ? OFFSET ?
      `),
      count: db.prepare(`SELECT COUNT(*) AS total FROM guests ${where}`),
    },
  ]),
)

const exportStatement = db.prepare(`
  SELECT name, email, phone, code, ref_code, ticket_type, quantity, total, checked_in, checked_in_count, admissions, checked_in_at, merch, merch_items, merch_checked_in, merch_checked_in_at
  FROM guests
  ORDER BY normalized_name
`)

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)

    if (request.method === 'OPTIONS') {
      return send(response, 204)
    }

    // Public health check (used by cloud platforms) — no auth required.
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(response, 200, { ok: true })
    }

    // Serve the built client for any non-API GET (single-service deploy).
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      return serveStatic(response, url.pathname)
    }

    if (request.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(request)
      const user = resolveUser(body.username, body.password)
      if (user) {
        return send(response, 200, { token: makeToken(user), role: user.role, username: user.username, displayName: user.displayName })
      }

      return send(response, 401, { message: 'Wrong login details' })
    }

    const session = getSession(request)
    if (!session) {
      return send(response, 401, { message: 'Login required' })
    }
    const isAdmin = session.role === 'admin'

    if (request.method === 'GET' && url.pathname === '/api/stats') {
      return send(response, 200, buildStats())
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/guests') {
      if (!isAdmin) return send(response, 403, { message: 'Admin access required' })

      const filterKey = ROSTER_FILTERS[url.searchParams.get('filter')] !== undefined
        ? url.searchParams.get('filter')
        : 'all'
      const statements = rosterStatements[filterKey]
      const total = statements.count.get().total
      const pageCount = Math.max(1, Math.ceil(total / ROSTER_PAGE_SIZE))
      const page = Math.min(pageCount, Math.max(1, Number(url.searchParams.get('page')) || 1))
      const offset = (page - 1) * ROSTER_PAGE_SIZE
      const guests = statements.page.all(ROSTER_PAGE_SIZE, offset).map(formatGuest)

      return send(response, 200, {
        guests,
        total,
        page,
        pageCount,
        pageSize: ROSTER_PAGE_SIZE,
        filter: filterKey,
        stats: buildStats(),
      })
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/export.csv') {
      if (!isAdmin) return send(response, 403, { message: 'Admin access required' })
      return sendCsv(response, buildCsv(exportStatement.all()))
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/audit.csv') {
      if (!isAdmin) return send(response, 403, { message: 'Admin access required' })
      return sendCsv(response, buildAuditCsv(auditExportStatement.all()), 'tedx-audit-log.csv')
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/import') {
      if (!isAdmin) return send(response, 403, { message: 'Admin access required' })
      const body = await readJson(request)
      const files = Array.isArray(body.files) ? body.files : []
      const texts = files.map((f) => String(f?.content || '')).filter((t) => t.trim().length > 0)
      if (texts.length === 0) return send(response, 400, { message: 'No CSV content received' })
      try {
        const summary = importSales(db, texts)
        return send(response, 200, { summary, stats: buildStats() })
      } catch (error) {
        console.error('Import failed:', error)
        return send(response, 500, { message: 'Import failed — no changes were applied' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/guests/search') {
      const query = normalizeSearch(url.searchParams.get('q') || '')
      if (query.length === 0) {
        return send(response, 200, { guests: [], stats: buildStats() })
      }

      const guests = searchStatement.all(
        `%${query}%`,
        `${query}%`,
        `${query}%`,
        `%${query}%`,
        query,
        `${query}%`,
        `% ${query}%`,
      ).map(formatGuest)

      return send(response, 200, { guests, stats: buildStats() })
    }

    if (request.method === 'POST' && url.pathname === '/api/guests') {
      const body = await readJson(request)
      const name = String(body.name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const phone = String(body.phone || '').trim()
      const ticketType = String(body.ticket_type || '').trim()
      const hasTicket = Boolean(TICKET_TYPES[ticketType])
      const merchSelected = Array.isArray(body.merch_items)
        ? REGISTER_MERCH.filter((item) => body.merch_items.includes(item))
        : []

      if (!name) return send(response, 400, { message: 'Name is required' })
      if (!email) return send(response, 400, { message: 'Email is required' })
      if (ticketType && !hasTicket) {
        return send(response, 400, { message: 'Pick a valid ticket type' })
      }
      if (!hasTicket && merchSelected.length === 0) {
        return send(response, 400, { message: 'Add a ticket or at least one merch item' })
      }

      if (emailExistsStatement.get(email)) {
        return send(response, 409, { message: 'A guest with this email already exists' })
      }

      const quantity = hasTicket ? Math.max(1, Number(body.quantity) || 1) : 0
      const priceInput = Number(body.price)
      const validPrice = Number.isFinite(priceInput) && priceInput >= 0
      const total = hasTicket
        ? (validPrice ? priceInput : TICKET_TYPES[ticketType]) * quantity
        : (validPrice ? priceInput : 0)
      const merch = merchSelected.length > 0 ? 1 : 0
      const merchItems = merch ? JSON.stringify(merchSelected.map((item) => ({ item, qty: 1 }))) : null

      let code, refCode
      try {
        ({ code, refCode } = generateUniqueCodes())
      } catch {
        return send(response, 409, { message: `All codes ${CODE_MIN}-${CODE_MAX} are taken` })
      }

      const result = insertGuestStatement.run(
        name,
        normalizeSearch(name),
        email,
        phone,
        code,
        refCode,
        hasTicket ? ticketType : null,
        quantity,
        total,
        merch,
        merchItems,
      )

      const newGuest = guestStatement.get(Number(result.lastInsertRowid))
      recordAudit(session.username, 'register', newGuest, `${hasTicket ? `${ticketType} x${quantity}` : 'no ticket'}${merch ? ` · ${merchSelected.join(', ')}` : ''}`)

      return send(response, 201, {
        guest: formatGuest(newGuest),
        stats: buildStats(),
      })
    }

    const guestMatch = url.pathname.match(/^\/api\/guests\/(\d+)$/)
    if (request.method === 'GET' && guestMatch) {
      const guest = guestStatement.get(Number(guestMatch[1]))
      if (!guest) return send(response, 404, { message: 'Guest not found' })

      return send(response, 200, { guest: formatGuest(guest) })
    }

    const actionMatch = url.pathname.match(
      /^\/api\/guests\/(\d+)\/(check-in|check-in-merch|undo-check-in|undo-check-in-merch)$/,
    )
    if (request.method === 'POST' && actionMatch) {
      const id = Number(actionMatch[1])
      const action = actionMatch[2]
      const guest = guestStatement.get(id)

      if (!guest) return send(response, 404, { message: 'Guest not found' })

      if (action.startsWith('undo-') && !isAdmin) {
        return send(response, 403, { message: 'Admin access required' })
      }

      if (action === 'check-in') {
        const body = await readJson(request)
        const result = admitEntry(id, body)
        if (result.error) return send(response, 400, { message: result.error })
        recordAudit(session.username, 'check-in', guest, `admitted ${result.admitted} (now ${result.newCount}/${result.quantity})${result.companion ? ` · ${result.companion}` : ''}`)
      } else if (action === 'check-in-merch') {
        if (!guest.merch) {
          return send(response, 400, { message: 'This guest does not have merch' })
        }

        merchCheckInStatement.run(id)
        recordAudit(session.username, 'check-in-merch', guest, formatMerchItems(guest.merch_items))
      } else if (action === 'undo-check-in') {
        const result = undoEntry(id)
        recordAudit(session.username, 'undo-check-in', guest, `now ${result.newCount}/${result.quantity}`)
      } else {
        merchUndoStatement.run(id)
        recordAudit(session.username, 'undo-check-in-merch', guest, null)
      }

      return send(response, 200, {
        guest: formatGuest(guestStatement.get(id)),
        stats: buildStats(),
      })
    }

    const sellMatch = url.pathname.match(/^\/api\/guests\/(\d+)\/sell-ticket$/)
    if (request.method === 'POST' && sellMatch) {
      const id = Number(sellMatch[1])
      const guest = guestStatement.get(id)
      if (!guest) return send(response, 404, { message: 'Guest not found' })

      const body = await readJson(request)
      const ticketType = String(body.ticket_type || '').trim()
      if (!TICKET_TYPES[ticketType]) {
        return send(response, 400, { message: 'Pick a valid ticket type' })
      }

      sellTicketStatement.run(ticketType, TICKET_TYPES[ticketType], id)
      recordAudit(session.username, 'sell-ticket', guest, `${ticketType} (${TICKET_TYPES[ticketType]})`)

      return send(response, 200, {
        guest: formatGuest(guestStatement.get(id)),
        stats: buildStats(),
      })
    }

    return send(response, 404, { message: 'Not found' })
  } catch (error) {
    console.error(error)
    return send(response, 500, { message: 'Server error' })
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the process using it or set PORT to another free port.`)
  } else {
    console.error(error)
  }
  process.exit(1)
})

server.listen(PORT, () => {
  console.log(`TEDx registration API running on http://127.0.0.1:${PORT}`)
  console.log(`SQLite DB: ${dbPath}`)
})

function seedGuests() {
  const firstNames = [
    'Amina', 'Chidi', 'Tara', 'Daniel', 'Ife', 'Maya', 'Kelechi', 'Zara',
    'David', 'Nora', 'Samson', 'Ada', 'Tomi', 'Lara', 'Victor', 'Sade',
    'Emeka', 'Nkem', 'Bolu', 'Ruth', 'Malik', 'Esther', 'Tunde', 'Fola',
  ]
  const lastNames = [
    'Okafor', 'Johnson', 'Williams', 'Adebayo', 'Smith', 'Adeyemi', 'Brown',
    'Nwosu', 'Garcia', 'Eze', 'Martins', 'Olawale', 'Davis', 'Musa',
    'Okonkwo', 'Bello', 'Thomas', 'Obi', 'Wilson', 'Ibrahim',
  ]
  const insert = db.prepare(`
    INSERT INTO guests (name, normalized_name, email, phone, code, ref_code, checked_in, merch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    for (let index = 0; index < 520; index += 1) {
      const first = firstNames[index % firstNames.length]
      const last = lastNames[Math.floor(index / firstNames.length) % lastNames.length]
      const suffix = Math.floor(index / (firstNames.length * lastNames.length))
      const displaySuffix = suffix > 0 ? ` ${suffix + 1}` : ''
      const name = `${first} ${last}${displaySuffix}`
      const code = String(1000 + index).slice(-4)
      const refCode = `TX${String(26000 + index).slice(-5)}`
      const phone = `080${String(10000000 + index * 37).slice(-8)}`
      const emailName = `${first}.${last}${suffix > 0 ? suffix + 1 : ''}`.toLowerCase()

      insert.run(
        name,
        normalizeSearch(name),
        `${emailName}@example.com`,
        phone,
        code,
        refCode,
        0,
        index % 3 === 0 || index % 7 === 0 ? 1 : 0,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function ensureGuestSchema() {
  const columns = db.prepare('PRAGMA table_info(guests)').all().map((column) => column.name)

  if (!columns.includes('merch_checked_in')) {
    db.exec('ALTER TABLE guests ADD COLUMN merch_checked_in INTEGER NOT NULL DEFAULT 0')
    db.exec('UPDATE guests SET merch_checked_in = merch WHERE merch = 1')
  }

  if (!columns.includes('ticket_type')) {
    db.exec('ALTER TABLE guests ADD COLUMN ticket_type TEXT')
  }

  if (!columns.includes('quantity')) {
    db.exec('ALTER TABLE guests ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1')
  }

  if (!columns.includes('total')) {
    db.exec('ALTER TABLE guests ADD COLUMN total REAL')
  }

  if (!columns.includes('merch_items')) {
    db.exec('ALTER TABLE guests ADD COLUMN merch_items TEXT')
  }

  if (!columns.includes('checked_in_count')) {
    db.exec('ALTER TABLE guests ADD COLUMN checked_in_count INTEGER NOT NULL DEFAULT 0')
    // A pre-existing "checked in" order means everyone on it was admitted.
    db.exec('UPDATE guests SET checked_in_count = quantity WHERE checked_in = 1')
  }

  if (!columns.includes('admissions')) {
    db.exec('ALTER TABLE guests ADD COLUMN admissions TEXT')
  }
}

function seedMockMerchEntitlements() {
  const eligible = db.prepare('SELECT COUNT(*) AS total FROM guests WHERE merch = 1').get().total

  if (eligible < 40) {
    db.exec(`
      UPDATE guests
      SET merch = CASE WHEN id % 3 = 0 OR id % 7 = 0 THEN 1 ELSE merch END
    `)
  }
}

function normalizeSearch(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

const CODE_MIN = 1001
const CODE_MAX = 1100

function generateUniqueCodes() {
  const codeExists = db.prepare('SELECT id FROM guests WHERE code = ?')
  const refExists = db.prepare('SELECT id FROM guests WHERE ref_code = ?')

  let code = null
  for (let candidate = CODE_MIN; candidate <= CODE_MAX; candidate += 1) {
    if (!codeExists.get(String(candidate))) {
      code = String(candidate)
      break
    }
  }
  if (code === null) {
    throw new Error(`All registration codes ${CODE_MIN}-${CODE_MAX} are in use`)
  }

  let refCode
  do {
    refCode = `TXR${String(crypto.randomInt(100000)).padStart(5, '0')}`
  } while (refExists.get(refCode))

  return { code, refCode }
}

// Admit `count` people against an order, optionally naming a single companion.
// NOTE: re-reads the guest by id and writes in one synchronous pass. Because
// node:sqlite is synchronous and Node is single-threaded, this whole function
// runs atomically — two devices admitting the same guest can't interleave, so
// the counter can never be corrupted or over-admitted.
function admitEntry(id, body) {
  const guest = guestStatement.get(id)
  if (!guest) return { error: 'Guest not found' }

  const quantity = Math.max(1, Number(guest.quantity || 1))
  const already = Number(guest.checked_in_count || 0)
  const remaining = quantity - already
  if (remaining <= 0) return { error: 'Everyone on this order is already checked in' }

  const requested = Math.max(1, Number(body?.count) || 1)
  const admit = Math.min(requested, remaining)
  const companion = String(body?.companion || '').trim()

  const log = parseAdmissions(guest.admissions)
  const now = new Date().toISOString()
  for (let i = 0; i < admit; i += 1) {
    // Only attach a typed name when admitting one person at a time.
    log.push({ name: admit === 1 && companion ? companion : null, at: now })
  }

  const newCount = already + admit
  const checkedIn = newCount >= quantity ? 1 : 0
  const checkedInAt = guest.checked_in_at || now
  setEntryStatement.run(checkedIn, newCount, checkedInAt, JSON.stringify(log), id)
  return { admitted: admit, newCount, quantity, companion }
}

// Reverse the most recent admission (admin only). Also re-reads for atomicity.
function undoEntry(id) {
  const guest = guestStatement.get(id)
  if (!guest) return { error: 'Guest not found' }
  const quantity = Math.max(1, Number(guest.quantity || 1))
  const log = parseAdmissions(guest.admissions)
  log.pop()
  const newCount = Math.max(0, Number(guest.checked_in_count || 0) - 1)
  const checkedIn = newCount >= quantity ? 1 : 0
  const checkedInAt = newCount === 0 ? null : guest.checked_in_at
  setEntryStatement.run(checkedIn, newCount, checkedInAt, log.length ? JSON.stringify(log) : null, id)
  return { newCount, quantity }
}

function formatGuest(guest) {
  return {
    ...guest,
    quantity: Number(guest.quantity || 1),
    total: guest.total === null || guest.total === undefined ? null : Number(guest.total),
    checked_in: Boolean(guest.checked_in),
    checked_in_count: Number(guest.checked_in_count || 0),
    admissions: parseAdmissions(guest.admissions),
    merch: Boolean(guest.merch),
    merch_items: parseMerchItems(guest.merch_items),
    merch_checked_in: Boolean(guest.merch_checked_in),
  }
}

function parseAdmissions(value) {
  if (!value) return []
  try {
    const items = JSON.parse(value)
    return Array.isArray(items) ? items : []
  } catch {
    return []
  }
}

function parseMerchItems(value) {
  if (!value) return []
  try {
    const items = JSON.parse(value)
    return Array.isArray(items) ? items : []
  } catch {
    return []
  }
}

function formatMerchItems(value) {
  return parseMerchItems(value)
    .map((m) => `${m.item}${m.qty > 1 ? ` x${m.qty}` : ''}`)
    .join(', ')
}

function formatCompanions(value) {
  return parseAdmissions(value)
    .map((a, i) => `${i + 1}. ${a.name || 'Guest'}`)
    .join(' | ')
}

function normalizeStats(stats) {
  return {
    total: Number(stats.total || 0),
    checkedIn: Number(stats.checkedIn || 0),
    seats: Number(stats.seats || 0),
    merchEligible: Number(stats.merchEligible || 0),
    merchDone: Number(stats.merchDone || 0),
  }
}

// Full stats payload: totals + per-tier ticket breakdown.
function buildStats() {
  return {
    ...normalizeStats(statsStatement.get()),
    ticketTypes: ticketTypeStatement.all().map((row) => ({
      tier: row.tier,
      guests: Number(row.guests || 0),
      tickets: Number(row.tickets || 0),
    })),
  }
}

// Credentials come from env in production; the defaults are placeholders for
// local dev only. ALWAYS set USER_PASSWORD / ADMIN_PASSWORD on the host.
const CREDENTIALS = [
  { username: process.env.USER_USERNAME || 'user', password: process.env.USER_PASSWORD || 'changeme', role: 'user' },
  { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'changeme-admin', role: 'admin' },
]

if (!process.env.ADMIN_PASSWORD || !process.env.USER_PASSWORD) {
  console.warn('⚠ Using default dev passwords. Set USER_PASSWORD and ADMIN_PASSWORD env vars in production.')
}

function verifyPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(String(password), salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
}

// Returns { username, role, displayName } or null.
function resolveUser(username, password) {
  const envMatch = CREDENTIALS.find((c) => c.username === username && c.password === password)
  if (envMatch) return { username: envMatch.username, role: envMatch.role, displayName: envMatch.username }

  const row = userByName.get(String(username || ''))
  if (row && verifyPassword(password, row.salt, row.password_hash)) {
    return { username: row.username, role: row.role, displayName: row.display_name }
  }
  return null
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function makeToken(user) {
  const payload = b64url(JSON.stringify({ u: user.username, r: user.role, n: user.displayName, t: Date.now() }))
  const sig = b64url(crypto.createHmac('sha256', sessionSecret).update(payload).digest())
  return `${payload}.${sig}`
}

// Stateless: verify the HMAC signature instead of a server-side session store.
function getSession(request) {
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = b64url(crypto.createHmac('sha256', sessionSecret).update(payload).digest())
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null
  }
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    return { username: data.u, role: data.r, displayName: data.n }
  } catch {
    return null
  }
}

function recordAudit(actor, action, guest, detail) {
  try {
    insertAuditStatement.run(actor || 'unknown', action, guest?.id ?? null, guest?.name ?? null, guest?.code ?? null, detail ?? null)
  } catch (error) {
    console.error('audit log failed:', error)
  }
}

function buildCsv(rows) {
  const header = [
    'Name', 'Email', 'Phone', 'Code', 'Ref Code', 'Ticket Type', 'Quantity', 'Total Paid',
    'Admitted', 'Companions', 'Checked In At', 'Has Merch', 'Merch Items', 'Merch Collected', 'Merch Collected At',
  ]
  const lines = [header.map(csvCell).join(',')]

  for (const row of rows) {
    lines.push([
      row.name,
      row.email,
      row.phone,
      row.code,
      row.ref_code,
      row.ticket_type || '',
      row.quantity || 1,
      row.total === null || row.total === undefined ? '' : row.total,
      `${row.checked_in_count || 0} of ${row.quantity || 1}`,
      formatCompanions(row.admissions),
      row.checked_in_at || '',
      row.merch ? 'Yes' : 'No',
      formatMerchItems(row.merch_items),
      row.merch_checked_in ? 'Yes' : 'No',
      row.merch_checked_in_at || '',
    ].map(csvCell).join(','))
  }

  return lines.join('\r\n')
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function buildAuditCsv(rows) {
  const header = ['Time', 'Staff', 'Action', 'Guest', 'Code', 'Detail']
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.ts || '',
      row.actor || '',
      row.action || '',
      row.guest_name || '',
      row.guest_code || '',
      row.detail || '',
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n')
}

function sendCsv(response, csv, filename = 'tedx-guests.csv') {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  })
  response.end('﻿' + csv)
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(response, pathname) {
  if (!existsSync(distDir)) {
    return send(response, 404, { message: 'Client build not found — run npm run build' })
  }

  let relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  if (relative === '/' || relative === '\\' || relative === '.') relative = 'index.html'

  let filePath = join(distDir, relative)
  // Guard against path traversal, then fall back to the SPA entry point.
  if (!filePath.startsWith(distDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(distDir, 'index.html')
    if (!existsSync(filePath)) return send(response, 404, { message: 'Not found' })
  }

  const ext = filePath.slice(filePath.lastIndexOf('.'))
  const isHtml = ext === '.html'
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  response.end(readFileSync(filePath))
}

function send(response, status, data = null) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  })

  response.end(data === null ? '' : JSON.stringify(data))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk

      if (body.length > 10_000_000) {
        request.destroy()
        reject(new Error('Body too large'))
      }
    })

    request.on('end', () => {
      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })

    request.on('error', reject)
  })
}

// Create the 10 gate-staff logins (IGNITE theme) with hashed passwords.
//
// Usage:  node scripts/create_users.mjs            (creates any missing users)
//         node scripts/create_users.mjs --reset    (regenerates ALL passwords)
//
// Prints the usernames + freshly generated passwords ONCE — copy and distribute
// them to your team. Only salted scrypt hashes are stored in the database.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const dataDir = process.env.DATA_DIR || join(root, 'data')
const dbPath = join(dataDir, 'product-sales.sqlite')
const reset = process.argv.includes('--reset')

// IGNITE — "Ideas that set change in motion"
const STAFF = [
  ['catalyst', 'Catalyst'],
  ['kindle', 'Kindle'],
  ['momentum', 'Momentum'],
  ['trailblazer', 'Trailblazer'],
  ['beacon', 'Beacon'],
  ['phoenix', 'Phoenix'],
  ['wildfire', 'Wildfire'],
  ['ripple', 'Ripple'],
  ['lumen', 'Lumen'],
  ['ignition', 'Ignition'],
]

// Readable alphabet (no 0/O/1/l/I) for typeable one-time passwords.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
function genPassword(len = 10) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000;')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

const exists = db.prepare('SELECT 1 FROM users WHERE username = ?')
const insert = db.prepare('INSERT INTO users (username, display_name, role, password_hash, salt) VALUES (?, ?, ?, ?, ?)')
const update = db.prepare('UPDATE users SET password_hash = ?, salt = ?, display_name = ? WHERE username = ?')

const created = []
for (const [username, display] of STAFF) {
  const present = exists.get(username)
  if (present && !reset) continue
  const password = genPassword()
  const { salt, hash } = hashPassword(password)
  if (present) update.run(hash, salt, display, username)
  else insert.run(username, display, 'user', hash, salt)
  created.push({ username, password })
}

if (created.length === 0) {
  console.log('All 10 staff users already exist. Re-run with --reset to regenerate passwords.')
} else {
  console.log(`\n=== ${reset ? 'Reset' : 'Created'} ${created.length} gate-staff login(s) — copy & distribute ===\n`)
  console.log('USERNAME        PASSWORD')
  for (const c of created) console.log(`${c.username.padEnd(15)} ${c.password}`)
  console.log('\nRole: gate staff (check-in / merch / register). Log in at your site URL.')
}

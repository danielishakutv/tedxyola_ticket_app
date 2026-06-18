# TEDxYola Check-in App

A fast event check-in tool for TEDxYola: search guests, admit entries (including
multi-ticket orders where companions may arrive at different times), and track
merch pickup. Built with React (Vite) + a small Node server using `node:sqlite`.

## Features
- 🔎 Instant guest search by name, code, ref code, or phone
- 🎟️ Ticket tiers (Spark / Ember / Blaze) and quantities
- 👥 **Multi-ticket check-in** — admit people one at a time or all at once, with
  optional companion names; handles companions who arrive later
- 🎁 Merch tracking — shows exactly what each guest ordered, separate from entry
- 🛠️ Admin: roster with filters, CSV export, and **Import Sales** (upload Selar
  exports to load/update guests without losing check-in progress)

## Local development
```bash
npm install
npm run dev        # client on :5173, API on :8787
```
Default local logins (override in production with env vars):
- staff — `user` / `changeme`
- admin — `admin` / `changeme-admin`

Load guest data: log in as admin → **Import Sales** → upload the full Selar
sales CSV exports. (Or `npm run import:reports` with CSVs in `data/sales-reports/`.)

## Production / deployment
One Node service serves both the API and the built client. The database lives on
a persistent disk (`DATA_DIR`), and credentials come from environment variables.
See **[DEPLOY.md](DEPLOY.md)** for full steps (Render blueprint included).

## Privacy
Guest data (sales CSV exports and the SQLite database) contains personal
information and is **git-ignored** — it is never committed. Keep exports outside
the repository.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Run client + API for local development |
| `npm run build` | Build the client into `dist/` |
| `npm start` | Run the production server (serves API + `dist/`) |
| `npm run import:reports` | Import sales CSVs from `data/sales-reports/` (CLI) |

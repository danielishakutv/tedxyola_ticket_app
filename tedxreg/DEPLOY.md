# Deploying the TEDxYola check-in app

The app is **one Node service**: `server.mjs` serves both the JSON API (`/api/*`)
and the built React client (everything else). The guest database is a SQLite
file that must live on a **persistent disk** so deploys never erase check-in data.

---

## Decisions already made (and how to change them)

| Decision | Why | How to change |
|---|---|---|
| **Single service** (Node serves API + client) | Simplest cloud deploy — one service, one URL, no reverse proxy | Split into static host + API and add a proxy for `/api`; remove `serveStatic` from `server.mjs` |
| **DB on a persistent disk** via `DATA_DIR` env | So redeploys don't overwrite live check-ins | Point `DATA_DIR` anywhere writable; default is `./data` (local) |
| **DB is NOT in git** (untracked + git-ignored) | Customer PII must not sit in the repo; deploys must not ship/overwrite a DB | It's intentional — load data via "Import Sales" after deploy |
| **Data loaded via in-app "Import Sales"** (admin) | One workflow for both first load and ongoing sales updates; preserves check-ins | You can instead SSH in and run `npm run import:reports` against the volume |
| **Secrets via env vars** (`ADMIN_PASSWORD`, `USER_PASSWORD`) | Hardcoded passwords were readable in the public repo | Set them in the host dashboard; defaults only apply locally |
| **Mock seeding off** unless `SEED_MOCK=true` | A fresh prod DB must not fill with 520 fake guests | Set `SEED_MOCK=true` only for a throwaway demo |
| **Recommended host: Render** | Easiest UI with a real persistent disk; `render.yaml` included | Railway, Fly.io, or any VPS work too (notes below) |

> ⚠️ **Make the GitHub repo private.** The history already contains an old copy
> of the database with customer data. Settings → General → Danger Zone → change
> visibility. (Going forward the DB is git-ignored, so no new PII is committed.)

---

## Deploy on Render (recommended)

1. Push the repo to GitHub (the `render.yaml` is picked up automatically).
2. Render → **New → Blueprint** → select the repo → it reads `render.yaml`.
3. In the service's **Environment** tab, set:
   - `ADMIN_PASSWORD` — a strong admin password
   - `USER_PASSWORD` — the gate-staff password
4. Deploy. (A persistent disk needs the **Starter** plan, ~$7/mo. The free plan
   has no disk and sleeps — don't use it for the event.)
5. Open the URL, log in as **admin**, click **Import Sales**, and upload the full
   Selar exports (the ticket report + each merch report). Guests load instantly.

**Required env vars**

| Var | Value | Notes |
|---|---|---|
| `DATA_DIR` | `/data` | matches the mounted disk |
| `NODE_VERSION` | `22.20.0` | required for `node:sqlite` |
| `ADMIN_PASSWORD` | _your secret_ | |
| `USER_PASSWORD` | _your secret_ | |
| `PORT` | _(set by Render)_ | do not hardcode |

---

## Getting sales updates in (before or during the event)

When more tickets sell on Selar:

1. Export the **full** reports again from Selar (not just the new sales).
2. In the app (admin) → **Import Sales** → select all the CSVs → upload.

The import **updates existing buyers, adds new ones, and never touches check-in
progress** (who's admitted, companions, merch collected are all preserved). If
someone buys more tickets, their seat count goes up and the counter shows the
new "still to come".

Rules:
- **Always upload complete exports**, not partial deltas — merch is re-derived
  from the files, so a partial file would clear merch for anyone not in it.
- For a single walk-in, just use **Quick Register** instead.

---

## Other hosts (brief)

- **Railway** — add the repo, attach a Volume mounted at `/data`, set the same
  env vars, start command `npm start`, build `npm install && npm run build`.
- **Fly.io** — `fly launch` (Node), create a volume (`fly volumes create tedx_data`),
  mount at `/data`, set `DATA_DIR=/data` and secrets via `fly secrets set`.
- **VPS** — Node 22.20+, `npm ci && npm run build`, run `npm start` under a
  process manager (pm2/systemd) with `DATA_DIR` on disk, and put HTTPS in front
  (Caddy/nginx). The Node server already serves the client, so the proxy only
  needs to forward all traffic to it.

Always serve over **HTTPS** (all the hosts above do this for you).

#!/usr/bin/env bash
# Pull the latest code and redeploy. The database lives in DATA_DIR
# (/var/lib/tedxreg), OUTSIDE the repo, so this never touches live data.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # -> tedxreg/

echo "→ pulling latest…"
git pull --ff-only

echo "→ installing deps…"
npm ci

echo "→ building client…"
npm run build

echo "→ restarting service…"
sudo systemctl restart tedxreg

echo "✓ deployed. Status:"
sudo systemctl --no-pager status tedxreg | head -n 5

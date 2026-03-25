#!/bin/sh
set -ex
cd /data/robocolony
git pull origin main
# npm install may hang via proxy — use timeout and tolerate failures
timeout 30 npm install --omit=dev 2>&1 || echo "[startup] npm install failed/timed out — using cached node_modules"
NODE_ENV=production exec node dist/server.js

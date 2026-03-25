#!/bin/sh
set -ex
cd /data/robocolony
# git pull with 30s timeout (may hang on large repos)
timeout 30 git pull origin main || echo "[startup] git pull failed/timed out — using existing code"
# npm install with 30s timeout
timeout 30 npm install --omit=dev 2>&1 || echo "[startup] npm install failed/timed out — using cached node_modules"
NODE_ENV=production exec node dist/server.js

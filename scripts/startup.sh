#!/bin/sh
set -e

cd /data/robocolony
git pull origin main

# npm install may fail via proxy — tolerate since deps persist on volume
npm install --omit=dev 2>&1 || echo "[startup] npm install failed — using cached node_modules"

NODE_ENV=production exec node dist/server.js

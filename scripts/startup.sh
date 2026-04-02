#!/bin/sh
set -ex
apk add --no-cache git
cd /data/robocolony
git pull origin main
npm install
npm run build
NODE_ENV=production exec node dist/server.js

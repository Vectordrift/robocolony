#!/bin/sh
set -ex
apk add --no-cache git
cd /data/robocolony
git pull origin main
npm install 2>&1
npx tsc 2>&1
NODE_ENV=production exec node dist/server.js
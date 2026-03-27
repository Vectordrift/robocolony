#!/bin/bash
# deploy-robocolony.sh — Deploy RoboColony to Fly.io from the current repo state.
# Requires the Fly image-based machine path and a configured FLY_API_TOKEN when
# using GitHub Actions. Local use requires authenticated flyctl.

set -euo pipefail

APP="robocolony"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== RoboColony Deploy ==="
cd "$ROOT_DIR"

if ! command -v /opt/homebrew/bin/flyctl >/dev/null 2>&1 && ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl is required but was not found."
  exit 1
fi

FLYCTL_BIN="${FLYCTL_BIN:-$(command -v flyctl || true)}"
if [[ -z "$FLYCTL_BIN" && -x /opt/homebrew/bin/flyctl ]]; then
  FLYCTL_BIN="/opt/homebrew/bin/flyctl"
fi

echo "Deploying app '$APP' with image-based rollout..."
GIT_SHA="$(git rev-parse HEAD)"
BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$FLYCTL_BIN" deploy --remote-only --depot=false -a "$APP" \
  --ha=false \
  --strategy immediate \
  --build-arg "VCS_REF=$GIT_SHA" \
  --build-arg "BUILD_TIMESTAMP=$BUILD_TIMESTAMP"

echo "Waiting for public health..."
for attempt in 1 2 3 4 5; do
  HEALTH_JSON="$(curl -fsS --max-time 10 "https://$APP.fly.dev/health" || true)"
  if [[ "$HEALTH_JSON" == *'"status":"ok"'* ]]; then
    echo "Deploy healthy: $HEALTH_JSON"
    echo "=== Deploy complete ==="
    exit 0
  fi
  echo "Health not ready yet (attempt $attempt/5)"
  sleep 5
done

echo "Deployment did not become healthy in time."
exit 2

#!/bin/bash
# deploy-robocolony.sh — Deploy RoboColony to Fly.io
# REQUIRES CI to be green on main HEAD before deploying.
# Usage: bash scripts/deploy-robocolony.sh
# Exit codes: 0 = deployed, 1 = CI not green (blocked), 2 = deploy failed

set -euo pipefail

REPO="Vectordrift/robocolony"
APP="robocolony"
MACHINE_ID="e7844154b51068"
FLY_API="https://api.machines.dev/v1"

parse() {
  node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const d=r.__untrusted?r.data:r; $1"
}

echo "=== RoboColony Deploy ==="

# Step 1: Get main HEAD
HEAD_SHA=$(curl -s "https://api.github.com/repos/$REPO/git/ref/heads/main" | parse "process.stdout.write(d.object.sha)")
SHORT_SHA="${HEAD_SHA:0:7}"
echo "Main HEAD: $SHORT_SHA"

# Step 2: Check CI status on HEAD commit
echo "Checking CI status..."

MAX_WAIT=180  # 3 minutes max wait for CI
POLL_INTERVAL=15
ELAPSED=0

while true; do
  CI_STATUS=$(curl -s "https://api.github.com/repos/$REPO/commits/$HEAD_SHA/status" | parse "process.stdout.write(d.state || 'unknown')")
  
  # Also check check-runs (GitHub Actions uses check runs, not commit status)
  CHECK_RESULT=$(curl -s "https://api.github.com/repos/$REPO/commits/$HEAD_SHA/check-runs" | parse "
    const runs = d.check_runs || [];
    if (runs.length === 0) { process.stdout.write('none'); }
    else {
      const latest = runs[0];
      process.stdout.write(latest.status + ':' + (latest.conclusion || 'pending'));
    }
  ")
  
  echo "  CI commit status: $CI_STATUS | Check runs: $CHECK_RESULT"
  
  # Parse check run result
  CHECK_STATUS=$(echo "$CHECK_RESULT" | cut -d: -f1)
  CHECK_CONCLUSION=$(echo "$CHECK_RESULT" | cut -d: -f2)
  
  # If it's a [skip ci] commit (e.g. CI auto-commit of dist/), check the parent
  COMMIT_MSG=$(curl -s "https://api.github.com/repos/$REPO/git/commits/$HEAD_SHA" | parse "process.stdout.write((d.message||'').split('\\n')[0])")
  
  if [[ "$CHECK_RESULT" == "none" && "$COMMIT_MSG" == *"[skip ci]"* ]]; then
    echo "  HEAD is a [skip ci] commit. Checking parent..."
    PARENT_SHA=$(curl -s "https://api.github.com/repos/$REPO/git/commits/$HEAD_SHA" | parse "process.stdout.write(d.parents[0].sha)")
    PARENT_SHORT="${PARENT_SHA:0:7}"
    
    CHECK_RESULT=$(curl -s "https://api.github.com/repos/$REPO/commits/$PARENT_SHA/check-runs" | parse "
      const runs = d.check_runs || [];
      if (runs.length === 0) { process.stdout.write('none'); }
      else {
        const latest = runs[0];
        process.stdout.write(latest.status + ':' + (latest.conclusion || 'pending'));
      }
    ")
    CHECK_STATUS=$(echo "$CHECK_RESULT" | cut -d: -f1)
    CHECK_CONCLUSION=$(echo "$CHECK_RESULT" | cut -d: -f2)
    echo "  Parent $PARENT_SHORT check runs: $CHECK_RESULT"
  fi
  
  # Decision
  if [[ "$CHECK_STATUS" == "completed" && "$CHECK_CONCLUSION" == "success" ]]; then
    echo "✅ CI is GREEN. Proceeding with deploy."
    break
  elif [[ "$CHECK_STATUS" == "completed" && "$CHECK_CONCLUSION" != "success" ]]; then
    echo "❌ CI FAILED ($CHECK_CONCLUSION). DEPLOY BLOCKED."
    echo "Fix the CI failure before deploying."
    exit 1
  elif [[ "$CHECK_RESULT" == "none" ]]; then
    # No CI runs at all — might be very new commit or CI not configured
    if [[ $ELAPSED -ge 60 ]]; then
      echo "⚠️ No CI runs found after 60s. DEPLOY BLOCKED (CI must run)."
      exit 1
    fi
  fi
  
  # CI still running — wait
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "⏰ CI still pending after ${MAX_WAIT}s. DEPLOY BLOCKED."
    echo "Wait for CI to finish, then retry."
    exit 1
  fi
  
  echo "  CI in progress. Waiting ${POLL_INTERVAL}s... (${ELAPSED}s/${MAX_WAIT}s)"
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# Step 3: Stop the machine
echo "Stopping machine $MACHINE_ID..."
STOP_RESULT=$(curl -s -X POST "$FLY_API/apps/$APP/machines/$MACHINE_ID/stop" -H "Content-Type: application/json" | parse "process.stdout.write(JSON.stringify(d))")
echo "  Stop: $STOP_RESULT"
sleep 5

# Step 4: Start the machine (does git pull on boot)
echo "Starting machine $MACHINE_ID..."
START_RESULT=$(curl -s -X POST "$FLY_API/apps/$APP/machines/$MACHINE_ID/start" -H "Content-Type: application/json" | parse "process.stdout.write(JSON.stringify(d))")
echo "  Start: $START_RESULT"

# Step 5: Wait for health check
echo "Waiting for server to come up..."
sleep 15

HEALTH_OK=false
for i in 1 2 3 4 5; do
  HEALTH=$(curl -s --max-time 10 "https://robocolony.fly.dev/health" 2>/dev/null | parse "process.stdout.write(d.status || 'unknown')" 2>/dev/null || echo "unreachable")
  if [[ "$HEALTH" == "ok" ]]; then
    VERSION=$(curl -s "https://robocolony.fly.dev/health" | parse "process.stdout.write(d.version || d.sha?.slice(0,7) || 'unknown')")
    echo "✅ Server healthy! Version: $VERSION"
    HEALTH_OK=true
    break
  fi
  echo "  Health: $HEALTH (attempt $i/5)"
  sleep 10
done

if [[ "$HEALTH_OK" != "true" ]]; then
  echo "❌ Server failed to come up healthy after 5 attempts."
  echo "Manual investigation required."
  exit 2
fi

echo "=== Deploy complete ==="

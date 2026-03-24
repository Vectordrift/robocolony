# MEMORY.md — Project State

## Current Phase
**Phase 3: Buildings & Economy** (nearly complete)
Phase 4 (Combat) issues are being queued.

## Phase Status
- **Phase 1 (Foundation):** ✅ Complete — #1-#8 closed
- **Phase 2 (Movement & Exploration):** ✅ Complete — #18-#28 closed
- **Phase 3 (Buildings & Economy):** 🔧 In progress
  - ✅ #35 Build action (merged)
  - ✅ #36 Train unit action (merged 2026-03-24)
  - ⬜ #37 Settlement upgrade action
  - ⬜ #38 Demolish action + building decay
  - ✅ #40 Bug: null food/timber production (fixed 2026-03-24)
  - ✅ #44/#45 Resource rebalance + sanitization (merged 2026-03-24)
  - ✅ #47 Bug: food/timber null in production — startup normalization (fixed + deployed 2026-03-24)
- **Phase 4 (Combat):** Queued
  - ⬜ #43 Combat resolution

## Last Cycle (2026-03-24 20:04 UTC)
- Fixed live bug #47: food/timber were null in production events since tick 1. Root cause: deployed code still had `building.level * tierMult` (no fallback) and starting buildings stored `completedAtTick` instead of `level`. Fix #40 (code) was on main but not deployed. Added startup `normalizeData()` to fix existing DB data: normalizes building schemas and resets null/NaN resources to 0.
- Merged PR #48 (startup normalization)
- Deployed to production — health check passing, world at tick 26, running
- Closed issue #47
- No new issues needed (3 open: #37, #38, #43)

## Open Issues
- #37 Settlement upgrade action (phase-3, medium priority)
- #38 Demolish action + building decay (phase-3, medium priority)
- #43 Combat resolution (phase-4, high priority)

## Next Priorities
1. #37 Settlement upgrade (completes Phase 3 core)
2. #38 Demolish action
3. #43 Combat resolution (starts Phase 4)

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-24 20:13 UTC
- World: Genesis World (world_AYjUBQxhR1cQ) — tick 26, running

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
- **Phase 4 (Combat):** Queued
  - ⬜ #43 Combat resolution

## Last Cycle (2026-03-24 18:04 UTC)
- Fixed bug #40: starting buildings had `completedAtTick` instead of `level`, causing food/timber to become null after tick production. Root cause: schema mismatch between worlds.ts STARTING_BUILDINGS and tick engine Building interface. Added defensive `(building.level || 1)` fallback.
- Implemented #36: train_unit action. Units can be recruited at settlements with barracks. All 5 unit types with resource costs. 11 new tests. Also updated scheduler to insert (not just update) newly trained units.
- Created #43 (Phase 4: Combat resolution)
- Merged PR #41 (bug fix) and PR #42 (train_unit)

## Open Issues
- #37 Settlement upgrade action (phase-3, medium priority)
- #38 Demolish action + building decay (phase-3, medium priority)
- #43 Combat resolution (phase-4, high priority)

## Next Priorities
1. #37 Settlement upgrade (completes Phase 3 core)
2. #38 Demolish action
3. #43 Combat resolution (starts Phase 4)

## Deployed
- Live on Fly.io (agent-testing org, ams region)
- Bug #40 fix needs deploy to fix existing worlds with null resources

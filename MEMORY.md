# MEMORY.md — Project State

## Current Phase
**Phase 3: Buildings & Economy** — Complete ✅
**Phase 4: Combat** — Core combat implemented ✅ (settlement capture remaining)
**Phase 5: Diplomacy** — Next up (issues created)

Live playtesting active — playtesters filing bugs and balance issues.

## Phase Status
- **Phase 1 (Foundation):** ✅ Complete — #1-#8 closed
- **Phase 2 (Movement & Exploration):** ✅ Complete — #18-#28 closed
- **Phase 3 (Buildings & Economy):** ✅ Complete
  - ✅ Build action, train unit, settlement upgrade, demolish, building decay — all implemented
  - ✅ Resource rebalance (multiple passes: #44/#45, #64, #78, #79)
  - ✅ Stockpile decay + hard ceiling (#79 — aggressive 30% decay + 1.2× hard cap)
- **Phase 4 (Combat):** 🔧 Mostly complete
  - ✅ Combat resolution (auto-combat when opposing units share hex)
  - ✅ Attack action (pathfind toward target, combat on arrival)
  - ⬜ #86 Settlement capture when garrison destroyed
- **Phase 5 (Diplomacy):** Queued
  - ⬜ #83 Colony-to-colony messaging
  - ⬜ #84 Diplomatic agreements (NAP, trade, alliance)
- **Phase 6 (Website):** Partially done
  - ✅ Public feed, static website, event filtering
  - ⬜ #85 Leaderboard API endpoint

## Last Cycle (2026-03-25 10:04 UTC)
- **No open PRs** to review
- **Fixed #81** — Aggressive stockpile decay + hard ceiling
  - STOCKPILE_DECAY_RATE: 10% → 30% per tick
  - New STOCKPILE_HARD_CEILING: resources clamped to cap × 1.2 before % decay
  - Before: 500 timber → 480 after 1 tick. After: 500 timber → 342 after 1 tick
- **Closed #82** — Settlement upgrade path already exists (outpost→town needs pop 50, 3 buildings, resources). Commented with full requirements for playtester.
- **Created 4 new issues** (#83-#86) for Phase 5 diplomacy + Phase 4 capture + Phase 6 leaderboard
- **Deployed to production** — health check passing, world at tick 126

## Open Issues (4)
- #83 Feature: Colony-to-colony messaging (Phase 5)
- #84 Feature: Diplomatic agreements (Phase 5, depends on #83)
- #85 Feature: Leaderboard API endpoint (Phase 6)
- #86 Feature: Settlement capture (Phase 4 completion)

## Next Priorities
1. #83 Colony messaging (foundation for diplomacy)
2. #86 Settlement capture (completes Phase 4 combat)
3. #85 Leaderboard API (quick Phase 6 win)
4. #84 Agreements (after messaging is in)

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-25 10:10 UTC
- World: Genesis World (world_AYjUBQxhR1cQ) — tick 126, running

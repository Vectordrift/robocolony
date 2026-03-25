# MEMORY.md — Project State

## Current Phase
**Phase 3: Buildings & Economy** (nearly complete)
Phase 4 (Combat) issues are being queued.
Live playtesting active — playtesters filing bugs and balance issues.

## Phase Status
- **Phase 1 (Foundation):** ✅ Complete — #1-#8 closed
- **Phase 2 (Movement & Exploration):** ✅ Complete — #18-#28 closed
- **Phase 3 (Buildings & Economy):** 🔧 In progress
  - ✅ #35 Build action (merged)
  - ✅ #36 Train unit action (merged 2026-03-24)
  - ✅ #37 Settlement upgrade action (merged — already existed in code)
  - ⬜ #38 Demolish action + building decay
  - ✅ #40 Bug: null food/timber production (fixed 2026-03-24)
  - ✅ #44/#45 Resource rebalance + sanitization (merged 2026-03-24)
  - ✅ #47 Bug: food/timber null in production — startup normalization (fixed + deployed 2026-03-24)
- **Phase 4 (Combat):** Queued
  - ⬜ #43 Combat resolution

## Live-Test Issues (Playtester Feedback)
- ✅ #51 Balance: desertion cascade too punishing (fixed 2026-03-24)
- ⬜ #52 Balance: mid-game resource sinks (partially fixed in #64 — timber sinks added, remaining items need design input)
- ✅ #53 Bug: iron goes negative with no floor (fixed 2026-03-24)
- ✅ #54 Bug: rate limit batch rejection UX (fixed 2026-03-24)
- ⬜ #55 Design: enemy colony visibility after 48 ticks (needs Teemu input)
- ⬜ #60 Balance: idle units — no warnings or penalties (commented, needs idle event implementation)
- ✅ #61 Balance: food economy flat at break-even (fixed in #64 — farm +12, POP_FOOD 0.4, scout upkeep 0.5)
- ✅ #62 Balance: timber massively overproduced (fixed in #64 — lumberMill 4, timber upkeep on all buildings)
- ⬜ #63 Enhancement: no feedback on queued action outcomes

## Last Cycle (2026-03-25 01:04 UTC)
- **PR #64 merged:** Economy balance retuning. Addresses #61 (food flatline) and #62 (timber flood). Partially addresses #52 (resource sinks).
  - Farm production: 10 → 12 food/tick/level
  - LumberMill production: 6 → 4 timber/tick/level
  - Added timber upkeep to farm (1), lumberMill (1), barracks (1) per level
  - POP_FOOD_CONSUMPTION: 0.5 → 0.4 (reduced pop pressure)
  - POP_GROWTH_PER_FOOD: 10 → 5 (growth on smaller surplus)
  - Scout food upkeep: 1.0 → 0.5 (scouts forage)
- **Closed #61, #62** with detailed change notes
- **Commented on #52** (partially addressed, influence system still inert, stone/iron sinks still needed)
- **Commented on #60** (scout upkeep reduced, but idle unit events still needed as feature)
- **Deployed to production** — health check passing, world at tick 78, running.

## Open Issues
- #38 Demolish action + building decay (phase-3)
- #43 Combat resolution (phase-4)
- #52 Balance: mid-game resource sinks (partially fixed, remaining items need design input)
- #55 Design: enemy colony visibility (needs Teemu input)
- #60 Balance: idle units — no warnings (needs idle event feature)
- #63 Enhancement: queued action outcome feedback

## Next Priorities
1. #38 Demolish action (completes Phase 3 core)
2. #60 Idle unit events (quick win from playtester feedback)
3. #43 Combat resolution (starts Phase 4)
4. #55/#52 remaining items pending Teemu design decisions

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-25 01:18 UTC
- World: Genesis World (world_AYjUBQxhR1cQ) — tick 78, running

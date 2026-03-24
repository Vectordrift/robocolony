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
  - ⬜ #37 Settlement upgrade action
  - ⬜ #38 Demolish action + building decay
  - ✅ #40 Bug: null food/timber production (fixed 2026-03-24)
  - ✅ #44/#45 Resource rebalance + sanitization (merged 2026-03-24)
  - ✅ #47 Bug: food/timber null in production — startup normalization (fixed + deployed 2026-03-24)
- **Phase 4 (Combat):** Queued
  - ⬜ #43 Combat resolution

## Live-Test Issues (Playtester Feedback)
- ✅ #51 Balance: desertion cascade too punishing (fixed 2026-03-24 — severity-scaled morale + probabilistic desertion)
- ⬜ #52 Balance: mid-game resource sinks (commented with analysis, needs Teemu input)
- ✅ #53 Bug: iron goes negative with no floor (fixed 2026-03-24 — all resources clamped to 0)
- ✅ #54 Bug: rate limit batch rejection UX (fixed 2026-03-24 — syntax also fixed from prior commit)
- ⬜ #55 Design: enemy colony visibility after 48 ticks (commented with analysis, needs Teemu input)

## Last Cycle (2026-03-24 23:04 UTC)
- **PR #56 merged:** Bug fixes for #53 (resource floor) and #54 (rate limit error). Closes both.
- **PR #58 merged:** Balance fix for #51 (desertion cascade). Severity-scaled morale loss + probabilistic desertion (30% chance per tick at threshold). Also fixed pre-existing syntax error in actions.ts (mismatched brace from a prior commit) and a failing pop growth test (farm L5 can't sustain 195 pop).
- **Commented on #52:** Resource sinks are a feature gap, not a tuning issue. Recommended building upgrades (L2/L3) as primary fix. Left for Teemu.
- **Commented on #55:** Map feels empty after 48 ticks. Recommended: reduce colony placement distance, add scout intel events, add map bounds hint. Left for Teemu.
- **Deployed to production** — health check passing, world at tick 55, running.
- Note: Found main was already broken (actions.ts syntax error from commit `5b2a2de3`, pop test failure). Both fixed in PR #58.

## Open Issues
- #37 Settlement upgrade action (phase-3)
- #38 Demolish action + building decay (phase-3)
- #43 Combat resolution (phase-4)
- #52 Balance: mid-game resource sinks (live-test, awaiting Teemu)
- #55 Design: enemy colony visibility (live-test, awaiting Teemu)

## Next Priorities
1. #37 Settlement upgrade (completes Phase 3 core)
2. #38 Demolish action
3. #43 Combat resolution (starts Phase 4)
4. New issues from #52/#55 if Teemu approves

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-24 23:20 UTC
- World: Genesis World (world_AYjUBQxhR1cQ) — tick 55, running

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
- ✅ #60 Balance: idle units — warning events implemented (PR #65, deployed 2026-03-25)
- ✅ #61 Balance: food economy flat at break-even (fixed in #64)
- ✅ #62 Balance: timber massively overproduced (fixed in #64)
- ⬜ #63 Enhancement: no feedback on queued action outcomes
- ✅ #76 Balance: famine death spiral (fixed in #78 — food/timber rebalance)
- ✅ #77 Balance: timber overproduction (fixed in #78 — lumberMill output + upkeep tuned)

## Last Cycle (2026-03-25 07:04 UTC)
- **No open PRs** to review
- **Fixed #76 + #77** — Major food/timber economy rebalance (PR #78)
  - Farm output 12→15 food/tick
  - Building food upkeep reduced: quarry 1→0, mine 2→1, barracks 3→2, market 2→1
  - Unit upkeep: militia 2→1.5, settler 5→3
  - Morale loss rate 0.05→0.03/tick
  - LumberMill output 4→3, self-upkeep 1→2
  - All tests updated, CI green, merged + deployed
- **Commented on #75** — drizzle-kit push bug already handled by Dockerfile CMD; remaining work is tick engine error handling
- **Deployed to production** — health check passing, world at tick 99

## Open Issues (5)
- #38 Demolish action + building decay (phase-3)
- #43 Combat resolution (phase-4)
- #55 Design: enemy colony visibility (needs Teemu input)
- #63 Enhancement: queued action outcome feedback
- #75 Bug: tick engine silent failure on DB errors (needs error handling fix)

## Next Priorities
1. #75 Tick engine error handling (prevent silent failures)
2. #38 Demolish action (completes Phase 3 core)
3. #63 Action outcome feedback (playtester QoL)
4. #43 Combat resolution (starts Phase 4)
5. #55 remaining items pending Teemu design decisions

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-25 07:14 UTC
- World: Genesis World (world_AYjUBQxhR1cQ) — tick 99, running

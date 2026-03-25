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

## Last Cycle (2026-03-25 02:04 UTC)
- **No open PRs** to review
- **Implemented #60** — Idle unit tracking and warning events
  - Added `idleTicks` field to Unit interface and DB schema
  - Track idle vs active per tick (movement, queue, actions)
  - Emit `unit_idle` event when idle for 3+ ticks (one-shot at threshold)
  - Persisted through scheduler, visible on public event feed
  - 7 new tests
  - PR #65 created, reviewed, merged
  - Issue #60 closed
- **Deployed to production** — health check passing, world at tick 89

## Open Issues
- #38 Demolish action + building decay (phase-3)
- #43 Combat resolution (phase-4)
- #52 Balance: mid-game resource sinks (partially fixed, remaining items need design input)
- #55 Design: enemy colony visibility (needs Teemu input)
- #63 Enhancement: queued action outcome feedback

## Next Priorities
1. #38 Demolish action (completes Phase 3 core)
2. #63 Action outcome feedback (playtester QoL)
3. #43 Combat resolution (starts Phase 4)
4. #55/#52 remaining items pending Teemu design decisions

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-25 02:14 UTC
- World: Genesis World (world_AYjUBQxhR1cQ) — tick 89, running

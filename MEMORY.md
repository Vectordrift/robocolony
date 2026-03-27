# MEMORY.md — Project State

## Current Phase
**Phase 5: Diplomacy** — Complete ✅
**Phase 6: Website** — In progress (hero section, how-to-play, API docs remaining)
**Phase 7: Admin** — Queued (#124)

Live playtesting active — playtesters filing bugs, balance issues, and suggestions.

## Phase Status
- **Phase 1 (Foundation):** ✅ Complete
- **Phase 2 (Movement & Exploration):** ✅ Complete
- **Phase 3 (Buildings & Economy):** ✅ Complete
- **Phase 4 (Combat):** ✅ Complete (including settlement capture)
- **Phase 5 (Diplomacy):** ✅ Complete
  - ✅ Colony-to-colony messaging
  - ✅ Diplomatic agreements (NAP, trade, alliance)
  - ✅ Auto-diplomacy responses (#167) — AI colonies auto-respond to proposals after 10 ticks
- **Phase 6 (Website):** 🔧 Partially done
  - ✅ Public feed, static website, event filtering, docs page
  - ⬜ #130 Hero section with live stats
  - ⬜ #131 How to Play section
  - ⬜ #132 API documentation page
- **Phase 7 (Admin):** Queued
  - ⬜ #124 Admin endpoints (pause/resume, status dashboard)

## Last Cycle (2026-03-27 04:04 UTC)
- **No open PRs** to review
- **Fixed #171** — Morale death spiral balance changes:
  - COMBAT_MORALE_LOSE: 0.15 → 0.10
  - HOMELAND_MORALE_BONUS: 0.1 → 0.15
  - GARRISON_MORALE_FLOOR: 0.6 → 0.7
  - Garrison heal morale: 0.05 → 0.08
  - NEW: Passive morale recovery +0.02/tick for all units
- **Fixed #167** — Auto-diplomacy system: colonies auto-respond to pending agreement proposals after 10 ticks (NAPs accepted, alliances accepted unless at war, trade rejected)
- **Triaged #172** (suggestion: late-game resource sinks) — Closed with detailed response. Valid feedback but deferred to Phase 2+ design. Several suggested features already partially exist.
- **Deployed** commit 7e49ddf to production — health check passing

## Open Issues (5)
- #99 Feature: Public website (world feed, leaderboard, how-to-play)
- #124 Feature: Admin endpoints (Phase 7)
- #130 Feature: Website hero section with live stats (MVP)
- #131 Feature: How to Play section with API quickstart (MVP)
- #132 Feature: API documentation page (MVP)

## Next Priorities
1. #130 Website hero section (MVP label, builds on existing website)
2. #131 How to Play section (MVP label)
3. #132 API docs page (MVP label)
4. #124 Admin endpoints (Phase 7)
5. #99 is a meta-issue that overlaps with #130/#131 — may close as covered

## Deployed
- ✅ Live on Fly.io (agent-testing org, ams region)
- ✅ All fixes deployed as of 2026-03-27 04:20 UTC
- World: Genesis World — running

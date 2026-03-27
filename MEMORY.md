# MEMORY.md — Project State

## Current Phase
**Phase 6: Website** — ✅ Complete
**Phase 7: Polish** — In progress (#124 admin endpoints remaining)

Live playtesting active — playtesters filing bugs, balance issues, and suggestions.

## Phase Status
- **Phase 1 (Foundation):** ✅ Complete
- **Phase 2 (Movement & Exploration):** ✅ Complete
- **Phase 3 (Buildings & Economy):** ✅ Complete
- **Phase 4 (Combat):** ✅ Complete (including settlement capture)
- **Phase 5 (Diplomacy):** ✅ Complete
- **Phase 6 (Website):** ✅ Complete
  - ✅ Public feed, static website, event filtering
  - ✅ Hero section with live world stats (#130)
  - ✅ How to Play section (#131)
  - ✅ API documentation at /docs.html + /docs redirect (#132)
  - ✅ Leaderboard, colony name labels
- **Phase 7 (Polish):** 🔧 In progress
  - ✅ Deploy to Fly.io
  - ✅ Rate limiting
  - ✅ API documentation
  - ⬜ #124 Admin endpoints (pause/resume, status dashboard)

## Last Cycle (2026-03-27 06:04 UTC)
- **No open PRs** to review
- **No suggestions** to triage
- **Shipped 6 issues:**
  - **#173 (balance)** — Combat minimum damage: military units now deal at least 1 damage per round. Prevents militia dealing 0 to soldiers.
  - **#174 (balance)** — Military bleedout: units at ≤5 HP after combat are destroyed. No more zombie militia.
  - **#130 (feature)** — Website hero section with title, tagline, live world stats (auto-refresh), API docs link
  - **#132 (feature)** — /docs and /api/docs redirect to /docs.html
  - **#131 (feature)** — Closed as already implemented (How to Play in sidebar)
  - **#99 (feature)** — Closed as fully implemented (website, feed, leaderboard, how-to-play, docs)
- **Created 4 new issues:**
  - #175 Bug: Tech bonuses (steel_weapons, fortifications) not applied in combat
  - #176 Enhancement: Update MVP doc to reflect completion status
  - #177 Feature: Unit healing at friendly settlements
  - #179 Enhancement: Add missing actions to API docs
- **Deployed** to production — health check passing, version de2d27c
- **Key discovery:** `steel_weapons` and `fortifications` techs are defined but never applied in combat code

## Open Issues (5)
- #124 Feature: Admin endpoints (Phase 7)
- #175 Bug: Tech bonuses not applied in combat
- #176 Enhancement: Update MVP doc status
- #177 Feature: Unit healing at settlements
- #179 Enhancement: Missing actions in API docs

## Architecture Notes
- **Repo:** `Vectordrift/robocolony` (public)
- **Stack:** TypeScript + Fastify + PostgreSQL + Drizzle + Vitest
- **Deploy:** Fly.io (`agent-testing` org, `ams` region)
- **Live at:** `robocolony.vectordrift.ai`
- **Tick rate:** 5 minutes
- **CI:** GitHub Actions — auto-builds dist/ and version.json on push
- **Website:** Static HTML in `web/` directory, served by @fastify/static
- **API docs:** `web/docs.html` (also accessible at /docs and /api/docs)

## Combat Constants (current)
| Constant | Value | Notes |
|----------|-------|-------|
| COMBAT_MINIMUM_DAMAGE | 1 | New in this cycle (#173) |
| COMBAT_BLEEDOUT_THRESHOLD | 5 | New in this cycle (#174) |
| COMBAT_MORALE_LOSS | 0.10 | All combatants |
| COMBAT_MORALE_WIN | 0.15 | Winners |
| COMBAT_MORALE_LOSE | 0.10 | Losers |
| HOMELAND_DEFENSE_RANGE | 5 | Hexes from own settlement |
| HOMELAND_MORALE_BONUS | 0.15 | Defending near home |
| GARRISON_MORALE_FLOOR | 0.70 | Min morale at own settlement |
| WALLS_DEFENSE_MULTIPLIER | 1.5 | Damage reduction behind walls |

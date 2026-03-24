# AGENTS.md — RoboColony Development Guide

> Persistent instructions for the lead developer agent building RoboColony.

---

## Identity

- **Role:** Lead developer (solo — no worker agents)
- **Workflow:** Implement directly on feature branches, open PRs, run tests, merge to `main`
- **Commit identity:** `teempai` / `11815232+teempai@users.noreply.github.com`
- **Commit tag:** `(ClawControlDev-Leader)`
- **Repo:** `Vectordrift/robocolony` (private)
- **Fly.io org:** `agent-testing`

---

## Development Workflow

### Branch Strategy

- `main` — always deployable. Never push directly.
- `feat/<name>` — feature branches. One branch per issue.
- `fix/<name>` — bug fix branches.

### Issue-Driven Development

All work is tracked via GitHub issues. Each issue has:
- Clear title and description
- Acceptance criteria (testable)
- Labels: `phase-1` through `phase-7`, `bug`, `security`, `ready`, `in-progress`, `done`

**Workflow per issue:**
1. Pick a `ready` issue → label `in-progress`
2. Create feature branch from `main`
3. Implement + write tests
4. Run `npm test` — all tests must pass
5. Open PR referencing the issue (`Closes #N`)
6. Review your own PR (check diff, verify tests cover acceptance criteria)
7. Merge (squash) → delete branch → issue auto-closes

### Hourly Cron Cycle

An hourly cron job triggers the development cycle:

1. **Check open PRs** — if tests pass, merge. If tests fail, fix.
2. **Check issue board** — pick up next `ready` issue if nothing is in-progress.
3. **Run test suite** — if anything broken on `main`, fix immediately (priority over new work).
4. **Create new issues** — if fewer than 3 `ready` issues exist, create from next phase tasks.
5. **Update MEMORY.md** — record what was done, current phase, blockers.

### Test Requirements

Every feature must have tests before merging:

- **Unit tests** for all engine logic (tick resolution, combat, pathfinding, economy)
- **Integration tests** for API endpoints (request/response, auth, error handling)
- **E2E tests** for multi-turn gameplay scenarios (colony joins → scouts → builds → fights)
- **Security tests** for auth bypass, injection, and data leakage (see Security section)

Test framework: **Vitest** (fast, TypeScript-native, good for both unit and integration).

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:e2e      # E2E/integration tests
npm run test:security # Security-focused tests
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js + TypeScript |
| API Framework | Fastify |
| Database | PostgreSQL |
| ORM | Drizzle |
| Test Framework | Vitest + Supertest |
| Deploy | Fly.io (`agent-testing` org) |
| CI | GitHub Actions (lint + test on PR) |

---

## Fly.io Deployment

### App Details

- **Org:** `agent-testing`
- **App name:** `robocolony` (to be created)
- **Region:** `ams` (close to dev machine)
- **Machine size:** `shared-cpu-1x`, 512MB RAM (sufficient for MVP)
- **Database:** Fly Postgres (single node, `shared-cpu-1x`, 1GB)

### Deploy Process

Deploy via Fly Machines API (no `flyctl` CLI needed — use HTTP API through auth proxy):

```bash
# Deploy new version
# 1. Build Docker image
# 2. Push to Fly registry
# 3. Update machine image

# For MVP, use Fly's built-in Dockerfile detection:
# fly deploy equivalent via Machines API
```

### Fly Machines API

Base URL: `https://api.machines.dev/v1/apps/robocolony`

Key endpoints:
```
GET    /machines              # List machines
POST   /machines              # Create machine
POST   /machines/:id/start    # Start machine
POST   /machines/:id/stop     # Stop machine
DELETE /machines/:id          # Destroy machine
```

Auth is handled automatically by the auth proxy.

### When to Deploy

- After merging a phase milestone (all phase issues closed, tests green)
- For E2E validation against a real database
- When transitioning to gameplay testing (keep machine running)

### Cost Management

- Stop the machine when not actively testing: `POST /machines/:id/stop`
- Machine auto-stops if idle (configure `auto_stop_machines` in fly.toml)
- Estimated cost: ~$5-10/month when running, $0 when stopped

---

## Implementation Phases

Follow the MVP plan in `docs/mvp.md`. Each phase maps to GitHub issues.

### Phase 1: Foundation (Target: Week 1)
- Project scaffolding (Fastify + TypeScript + Drizzle + Vitest)
- Database schema + migrations
- API key auth (generation, hashing, middleware)
- World creation + colony join endpoints
- Hex map generation (seeded noise, lazy)
- State query endpoints
- Action submission endpoint
- Tick engine skeleton (resource production only)
- Tick scheduler

### Phase 2: Movement & Exploration (Target: Week 2)
- Hex pathfinding (A* with terrain costs)
- Movement queue processing
- Fog of war filtering
- Scout exploration (reveal hexes)
- Settler + build settlement action
- Movement/exploration events

### Phase 3: Buildings & Economy (Target: Week 2-3)
- Building construction (queued, N ticks)
- Resource production (buildings + hex yields)
- Unit/building upkeep
- Unit recruitment
- Settlement upgrades (outpost → town → city)
- Resource deficit consequences

### Phase 4: Combat (Target: Week 3)
- Combat resolution (ratio-based + morale)
- Attack action
- Morale system (supply lines, recent battles)
- Walls (defense bonus)
- Settlement capture
- Combat events (private + public)

### Phase 5: Diplomacy (Target: Week 4)
- Message system
- Non-aggression pacts
- Trade agreements (auto-transfer per tick)
- Alliances (shared vision + mutual defense)
- Agreement breaking (Influence cost)
- Diplomatic events

### Phase 6: Website & Public Feed (Target: Week 4-5)
- Public feed endpoint (fog-of-war safe events only)
- Leaderboard endpoint (50-tick delay)
- Static website (hero, feed, leaderboard, how-to-play)
- Feed auto-refresh
- Mobile-responsive

### Phase 7: Security Review & Polish (Target: Week 5)
- Security audit (see Security section below)
- Balance pass
- Edge case handling
- API documentation (OpenAPI/Swagger)
- Rate limiting
- Integration tests for multi-colony scenarios
- Final deploy to Fly.io

---

## Security Review

### Threat Model

RoboColony is a competitive multiplayer game accessed via API. Malicious players have strong incentive to cheat. Key threats:

#### 1. Authentication Bypass
- **Threat:** Accessing another colony's data or submitting actions on their behalf.
- **Mitigations:**
  - API keys hashed with bcrypt. Never stored in plaintext.
  - Constant-time key comparison (prevent timing attacks).
  - API key bound to exactly one colony. Middleware verifies on every request.
- **Tests:** Attempt requests with invalid/missing/other colony's key. Verify 401/403.

#### 2. Fog of War Leakage
- **Threat:** API returns data the colony shouldn't see (unexplored hexes, enemy positions, resource levels).
- **Mitigations:**
  - All state queries filter through fog-of-war layer before response.
  - Public feed uses `publicData` field (sanitized) — never raw `data`.
  - Leaderboard stats delayed by 50 ticks.
  - Event visibility enforced: private events only visible to listed colony IDs.
- **Tests:** Join two colonies. Verify colony A cannot see colony B's units, unexplored hexes, or private events. Verify public feed contains no coordinates, troop counts, or resource levels.

#### 3. Action Injection
- **Threat:** Submitting actions for another colony, manipulating tick resolution, or exploiting race conditions.
- **Mitigations:**
  - Actions bound to authenticated colony ID from API key (not from request body).
  - Action validation: verify the colony owns the unit/settlement referenced.
  - Tick engine processes actions atomically (single transaction per tick).
- **Tests:** Submit action referencing another colony's unit. Verify rejection. Submit action during tick resolution. Verify queued for next tick.

#### 4. Resource/State Manipulation
- **Threat:** Overflowing resource values, creating duplicate units, building in invalid locations.
- **Mitigations:**
  - All game state changes go through tick engine (never direct DB writes from API).
  - Input validation on all action params (range checks, existence checks).
  - Constraints in database schema (foreign keys, NOT NULL, CHECK constraints).
- **Tests:** Submit actions with negative values, impossibly large values, references to non-existent entities. Verify all rejected with clear error.

#### 5. API Abuse / DoS
- **Threat:** Flooding the API to slow tick resolution or deny service to others.
- **Mitigations:**
  - Rate limiting: 10 requests per tick per colony (configurable).
  - Action limit: max 20 actions queued per tick per colony.
  - Request size limit: 10KB max body.
  - Tick engine has timeout — if resolution takes >10s, log and alert.
- **Tests:** Submit 100 rapid requests. Verify rate limit kicks in. Submit 50 actions. Verify excess rejected.

#### 6. Information Disclosure
- **Threat:** Error messages leaking internal state, stack traces, or database structure.
- **Mitigations:**
  - Production error handler returns generic messages (no stack traces).
  - No database column names in error responses.
  - API key never echoed back in responses.
  - Logs sanitized (no API keys in logs).
- **Tests:** Trigger various errors. Verify responses contain no internal details.

#### 7. Diplomacy Exploits
- **Threat:** Sending messages as another colony, forging agreements, reading others' messages.
- **Mitigations:**
  - Message `fromColonyId` always set from authenticated session (not request body).
  - Agreement proposals bound to authenticated colony.
  - Message inbox filtered to colony's own messages.
- **Tests:** Attempt to read another colony's messages. Send message with spoofed sender. Verify rejection.

### Security Test Suite

A dedicated `test/security/` directory with tests for each threat category:

```
test/security/
  auth-bypass.test.ts       # Tests for #1
  fog-of-war.test.ts        # Tests for #2
  action-injection.test.ts  # Tests for #3
  state-manipulation.test.ts # Tests for #4
  rate-limiting.test.ts     # Tests for #5
  info-disclosure.test.ts   # Tests for #6
  diplomacy-exploits.test.ts # Tests for #7
```

### Pre-Launch Security Checklist

- [ ] All security tests passing
- [ ] API keys never logged or returned after creation
- [ ] Error responses contain no internal details
- [ ] Rate limiting active and tested
- [ ] Fog of war verified with multi-colony scenario
- [ ] SQL injection tested (parameterized queries via Drizzle)
- [ ] Input validation on all endpoints (Fastify schema validation)
- [ ] CORS configured (restrict origins for website)
- [ ] Helmet.js or equivalent security headers
- [ ] No debug/admin endpoints exposed without admin auth

---

## Gameplay Testing (Post-Deploy)

Once the MVP is deployed and E2E tests pass, run gameplay testing:

### Self-Play Testing

The agent plays multiple colonies simultaneously to test balance:

1. **Spawn 4 colonies** with different strategies:
   - **Expansionist:** Prioritize settlers, found many outposts
   - **Militarist:** Build army early, attack nearest neighbor
   - **Diplomat:** Seek alliances, trade, grow peacefully
   - **Turtle:** Fortify one settlement, build economy

2. **Run for 200+ ticks.** Observe:
   - Does one strategy always dominate? (Bad — rebalance)
   - Do interesting conflicts emerge naturally? (Good)
   - Is the economy stable? (No runaway inflation or starvation)
   - Do agents run out of meaningful decisions? (Bad — add more options)

3. **Report findings to Teemu** with specific balance suggestions:
   - Which strategy dominated and why
   - Whether tick rate feels right
   - Whether resource scarcity creates interesting tension
   - Whether combat is too decisive or too indecisive
   - Proposed number changes (with reasoning)

### Automated Gameplay Tests

In addition to self-play, run automated scenario tests:

```typescript
// Example: "Two colonies at war" scenario
test('militarist vs turtle produces interesting game', async () => {
  const world = await createTestWorld()
  const aggressor = await joinWorld(world, 'Red Dawn')
  const defender = await joinWorld(world, 'Iron Keep')

  // Simulate 100 ticks with scripted strategies
  for (let tick = 0; tick < 100; tick++) {
    await submitAggressorActions(aggressor, world)
    await submitDefenderActions(defender, world)
    await resolveTick(world)
  }

  // Verify neither colony was eliminated in first 50 ticks (too fast = unbalanced)
  // Verify at least 1 battle occurred (too slow = boring)
  // Verify both colonies still have resources (economy works)
})
```

---

## Persistent State (MEMORY.md)

Update MEMORY.md after every work session with:

- **Current phase** and progress
- **Open issues** count and next priority
- **Test status** (last run, pass/fail)
- **Deploy status** (Fly.io machine state, last deploy SHA)
- **Blockers** (if any)
- **Balance notes** (from gameplay testing)

---

## File Structure (Target)

```
robocolony/
├── .github/
│   └── workflows/
│       └── ci.yml              # Lint + test on PR
├── docs/
│   ├── design.md               # Full design document
│   └── mvp.md                  # MVP plan
├── src/
│   ├── server.ts               # Fastify app setup
│   ├── config.ts               # Environment config
│   ├── db/
│   │   ├── schema.ts           # Drizzle schema
│   │   ├── migrations/         # SQL migrations
│   │   └── index.ts            # DB connection
│   ├── auth/
│   │   ├── keys.ts             # API key generation + hashing
│   │   └── middleware.ts       # Auth middleware
│   ├── engine/
│   │   ├── tick.ts             # Tick resolution (pure function)
│   │   ├── combat.ts           # Combat resolution
│   │   ├── economy.ts          # Resource production/consumption
│   │   ├── movement.ts         # Pathfinding + movement
│   │   ├── diplomacy.ts        # Agreement processing
│   │   ├── map.ts              # Hex generation + fog of war
│   │   └── events.ts           # Event generation (private + public)
│   ├── routes/
│   │   ├── worlds.ts           # World endpoints
│   │   ├── colony.ts           # Colony state endpoints
│   │   ├── actions.ts          # Action submission
│   │   ├── diplomacy.ts        # Messages + agreements
│   │   └── public.ts           # Feed + leaderboard (no auth)
│   └── scheduler.ts            # Tick scheduling
├── test/
│   ├── unit/
│   │   ├── tick.test.ts
│   │   ├── combat.test.ts
│   │   ├── economy.test.ts
│   │   ├── movement.test.ts
│   │   └── map.test.ts
│   ├── integration/
│   │   ├── api.test.ts
│   │   ├── auth.test.ts
│   │   └── gameplay.test.ts
│   ├── security/
│   │   ├── auth-bypass.test.ts
│   │   ├── fog-of-war.test.ts
│   │   ├── action-injection.test.ts
│   │   ├── state-manipulation.test.ts
│   │   ├── rate-limiting.test.ts
│   │   ├── info-disclosure.test.ts
│   │   └── diplomacy-exploits.test.ts
│   └── e2e/
│       └── full-game.test.ts
├── web/
│   ├── index.html              # Single-page website
│   ├── style.css
│   └── app.js                  # Feed + leaderboard client
├── Dockerfile
├── fly.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── AGENTS.md                   # This file
└── README.md
```

---

## Quick Reference

```bash
# Development
npm install                    # Install deps
npm run dev                    # Start dev server (with hot reload)
npm test                       # Run all tests
npm run test:unit              # Unit tests only
npm run test:security          # Security tests only
npm run db:migrate             # Run migrations
npm run db:seed                # Seed test data

# Deploy (via Fly Machines API)
# See deployment section above

# Gameplay testing
npm run test:gameplay          # Automated scenario tests
```

---

*This file is the single source of truth for how RoboColony is developed. Update it as the project evolves.*

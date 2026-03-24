# RoboColony — MVP Plan

> Minimum viable product: a playable Type 0 world that agents can interact with via API. No UI. Just the state machine, the API, and enough game mechanics to produce interesting agent behavior.

## MVP Scope

**In scope:**
- Type 0 gameplay only (pre-industrial hex map)
- 5 core resources (food, timber, stone, iron, influence)
- Settlements (outpost → town → city)
- 6 building types
- 5 unit types
- Movement and combat
- Basic diplomacy (messages + 3 agreement types)
- Fog of war
- Tick engine
- REST API
- Event feed
- Single world instance

**Out of scope for MVP:**
- Kardashev progression (Type 0.5+)
- World events
- Espionage
- Governors and policies
- Chronicle generation
- Wonders and artifacts
- Human briefing generation
- Multiple worlds
- UI of any kind

---

## Tech Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **API Server** | Node.js + TypeScript + Fastify | Fast, typed, easy to deploy |
| **State Store** | PostgreSQL | Reliable, good at structured game state, JSONB for flexible data |
| **Tick Engine** | Pure function (TypeScript) | Stateless, testable, `tick(state, actions) → state` |
| **Tick Scheduler** | Node.js setInterval or cron | Simple. Calls tick engine on schedule. |
| **Auth** | API keys per colony | Simple. One key = one colony. |
| **Deploy** | Fly.io (single machine to start) | Simple, cheap, good for stateful apps |

---

## Data Model

### World

```typescript
interface World {
  id: string
  name: string
  tickRate: number          // ms between ticks
  currentTick: number
  mapSeed: number           // for procedural generation
  status: 'waiting' | 'running' | 'paused'
  maxFactions: number
  createdAt: Date
}
```

### Hex

```typescript
interface Hex {
  x: number
  y: number
  terrain: 'plains' | 'forest' | 'mountains' | 'coast' | 'desert' | 'tundra' | 'ocean'
  resources: {
    food?: number       // yield per tick if worked
    timber?: number
    stone?: number
    iron?: number
  }
  settlementId?: string   // if a settlement is here
  explored_by: string[]   // colony IDs that have seen this hex
}
```

### Colony

```typescript
interface Colony {
  id: string
  worldId: string
  name: string
  apiKey: string
  resources: {
    food: number
    timber: number
    stone: number
    iron: number
    influence: number
  }
  income: {                // calculated per tick
    food: number
    timber: number
    stone: number
    iron: number
    influence: number
  }
  legacyScore: number
  createdAt: Date
}
```

### Settlement

```typescript
interface Settlement {
  id: string
  colonyId: string
  name: string
  hex: { x: number, y: number }
  tier: 'outpost' | 'town' | 'city'
  buildings: Building[]
  buildQueue: BuildQueueItem[]
  loyalty: number           // 0-100
  population: number        // affects production and upgrade eligibility
}

interface Building {
  type: BuildingType
  completedAtTick: number
}

type BuildingType = 'farm' | 'lumberMill' | 'quarry' | 'mine' | 'barracks' | 'market' | 'walls'

interface BuildQueueItem {
  type: BuildingType
  ticksRemaining: number
}
```

### Unit

```typescript
interface Unit {
  id: string
  colonyId: string
  type: 'scout' | 'militia' | 'soldier' | 'siege' | 'settler'
  hex: { x: number, y: number }
  health: number            // 0-100
  morale: number            // 0.5-1.5
  movementQueue: { x: number, y: number }[]   // queued path
}
```

### Action (queued by agents, resolved per tick)

```typescript
interface Action {
  id: string
  worldId: string
  colonyId: string
  tick: number              // which tick to resolve on
  type: ActionType
  params: Record<string, any>
  status: 'queued' | 'resolved' | 'failed'
  result?: string
}

type ActionType =
  | 'move_unit'             // { unitId, target: {x, y} }
  | 'attack'                // { unitId, target: {x, y} }
  | 'build_settlement'      // { unitId (settler), name }
  | 'build_building'        // { settlementId, buildingType }
  | 'upgrade_settlement'    // { settlementId }
  | 'recruit_unit'          // { settlementId, unitType }
  | 'trade_offer'           // { toFactionId, offer: {}, request: {} }
  | 'accept_agreement'      // { agreementId }
  | 'reject_agreement'      // { agreementId }
  | 'break_agreement'       // { agreementId }
  | 'send_message'          // { toFactionId, message }
  | 'disband_unit'          // { unitId }
```

### Agreement

```typescript
interface Agreement {
  id: string
  worldId: string
  type: 'non_aggression' | 'trade' | 'alliance'
  proposedBy: string        // colony ID
  proposedTo: string        // colony ID
  status: 'proposed' | 'active' | 'rejected' | 'broken'
  terms: Record<string, any>  // type-specific terms
  proposedAtTick: number
  acceptedAtTick?: number
}
```

### Event

```typescript
interface GameEvent {
  id: string
  worldId: string
  tick: number
  type: string              // 'combat' | 'settlement_founded' | 'agreement_proposed' | ...
  visibility: string[]      // colony IDs that can see this event ([] = public)
  data: Record<string, any>
}
```

### Message

```typescript
interface Message {
  id: string
  worldId: string
  fromFactionId: string
  toFactionId: string
  sentAtTick: number
  deliveredAtTick: number    // = sentAtTick + distance delay (MVP: instant)
  content: string
  read: boolean
}
```

---

## Database Schema (PostgreSQL)

```sql
CREATE TABLE worlds (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tick_rate   INTEGER NOT NULL DEFAULT 300000,  -- 5 min in ms
  current_tick INTEGER NOT NULL DEFAULT 0,
  map_seed    INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'waiting',
  max_colonies INTEGER NOT NULL DEFAULT 8,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hexes (
  world_id    TEXT REFERENCES worlds(id),
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  terrain     TEXT NOT NULL,
  resources   JSONB NOT NULL DEFAULT '{}',
  settlement_id TEXT,
  explored_by TEXT[] DEFAULT '{}',
  PRIMARY KEY (world_id, x, y)
);

CREATE TABLE colonies (
  id          TEXT PRIMARY KEY,
  world_id    TEXT REFERENCES worlds(id),
  name        TEXT NOT NULL,
  api_key     TEXT UNIQUE NOT NULL,
  resources   JSONB NOT NULL DEFAULT '{"food":100,"timber":50,"stone":30,"iron":10,"influence":50}',
  legacy_score INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE settlements (
  id          TEXT PRIMARY KEY,
  colony_id  TEXT REFERENCES colonies(id),
  world_id    TEXT REFERENCES worlds(id),
  name        TEXT NOT NULL,
  hex_x       INTEGER NOT NULL,
  hex_y       INTEGER NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'outpost',
  buildings   JSONB NOT NULL DEFAULT '[]',
  build_queue JSONB NOT NULL DEFAULT '[]',
  loyalty     INTEGER NOT NULL DEFAULT 100,
  population  INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE units (
  id          TEXT PRIMARY KEY,
  colony_id  TEXT REFERENCES colonies(id),
  world_id    TEXT REFERENCES worlds(id),
  type        TEXT NOT NULL,
  hex_x       INTEGER NOT NULL,
  hex_y       INTEGER NOT NULL,
  health      INTEGER NOT NULL DEFAULT 100,
  morale      REAL NOT NULL DEFAULT 1.0,
  movement_queue JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE actions (
  id          TEXT PRIMARY KEY,
  world_id    TEXT REFERENCES worlds(id),
  colony_id  TEXT REFERENCES colonies(id),
  tick        INTEGER NOT NULL,
  type        TEXT NOT NULL,
  params      JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  result      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agreements (
  id          TEXT PRIMARY KEY,
  world_id    TEXT REFERENCES worlds(id),
  type        TEXT NOT NULL,
  proposed_by TEXT REFERENCES colonies(id),
  proposed_to TEXT REFERENCES colonies(id),
  status      TEXT NOT NULL DEFAULT 'proposed',
  terms       JSONB NOT NULL DEFAULT '{}',
  proposed_at_tick INTEGER NOT NULL,
  accepted_at_tick INTEGER
);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  world_id    TEXT REFERENCES worlds(id),
  from_colony TEXT REFERENCES colonies(id),
  to_colony  TEXT REFERENCES colonies(id),
  sent_at_tick INTEGER NOT NULL,
  delivered_at_tick INTEGER NOT NULL,
  content     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  world_id    TEXT REFERENCES worlds(id),
  tick        INTEGER NOT NULL,
  type        TEXT NOT NULL,
  visibility  TEXT[] DEFAULT '{}',
  data        JSONB NOT NULL
);

CREATE INDEX idx_events_world_tick ON events(world_id, tick);
CREATE INDEX idx_actions_world_tick ON actions(world_id, tick, status);
CREATE INDEX idx_units_world_colony ON units(world_id, colony_id);
CREATE INDEX idx_hexes_world ON hexes(world_id, x, y);
```

---

## API Endpoints (MVP)

### World

```
GET  /api/worlds                     # List worlds
POST /api/worlds                     # Create world (admin only)
GET  /api/worlds/:id                 # World info (public)
```

### Colony (requires API key in header)

```
POST /api/worlds/:id/join            # Join world (creates colony)
GET  /api/worlds/:id/state           # Full colony state (map, units, settlements, resources)
GET  /api/worlds/:id/map             # Visible hex map (fog of war applied)
GET  /api/worlds/:id/events?since=N  # Events since tick N
```

### Actions

```
POST /api/worlds/:id/actions         # Submit action(s) for next tick
GET  /api/worlds/:id/actions         # List your queued/recent actions
```

### Diplomacy

```
POST /api/worlds/:id/messages        # Send message to another colony
GET  /api/worlds/:id/messages        # Inbox
POST /api/worlds/:id/agreements      # Propose agreement
PUT  /api/worlds/:id/agreements/:id  # Accept/reject
DELETE /api/worlds/:id/agreements/:id # Break agreement
```

### Auth

All colony endpoints require header: `Authorization: Bearer <api_key>`

---

## Tick Engine (Core Logic)

The tick engine is a pure function:

```typescript
function resolveTick(
  world: World,
  hexes: Hex[],
  colonies: Colony[],
  settlements: Settlement[],
  units: Unit[],
  actions: Action[],
  agreements: Agreement[]
): TickResult {
  // 1. Produce resources
  // 2. Consume upkeep
  // 3. Process movement
  // 4. Resolve combat
  // 5. Process construction
  // 6. Process recruitment
  // 7. Execute trade agreements
  // 8. Process diplomatic actions
  // 9. Update loyalty scores
  // 10. Generate events
  // 11. Update legacy scores

  return {
    updatedFactions,
    updatedSettlements,
    updatedUnits,
    newEvents,
    resolvedActions
  }
}
```

### MVP Combat Resolution

Simplified version:

```typescript
function resolveCombat(attackers: Unit[], defenders: Unit[], hex: Hex): CombatResult {
  const atkPower = attackers.reduce((sum, u) => sum + UNIT_STATS[u.type].attack * u.morale, 0)
  const defPower = defenders.reduce((sum, u) => sum + UNIT_STATS[u.type].defense * u.morale, 0)
    * (hex.settlementId ? 1.5 : 1.0)  // settlement bonus

  const ratio = atkPower / defPower
  const variance = 0.9 + Math.random() * 0.2  // ±10%
  const effectiveRatio = ratio * variance

  if (effectiveRatio > 2.0) return { winner: 'attacker', atkLossPct: 0.05, defLossPct: 1.0 }
  if (effectiveRatio > 1.5) return { winner: 'attacker', atkLossPct: 0.25, defLossPct: 1.0 }
  if (effectiveRatio > 1.0) return { winner: 'attacker', atkLossPct: 0.40, defLossPct: 0.80 }
  if (effectiveRatio > 0.7) return { winner: 'defender', atkLossPct: 0.30, defLossPct: 0.20 }
  if (effectiveRatio > 0.5) return { winner: 'defender', atkLossPct: 0.50, defLossPct: 0.10 }
  return { winner: 'defender', atkLossPct: 1.0, defLossPct: 0.05 }
}
```

### MVP Map Generation

```typescript
function generateHex(x: number, y: number, seed: number): Hex {
  const noise = seededNoise(x, y, seed)

  // Terrain based on noise value
  let terrain: Terrain
  if (noise < 0.15) terrain = 'ocean'
  else if (noise < 0.25) terrain = 'coast'
  else if (noise < 0.45) terrain = 'plains'
  else if (noise < 0.60) terrain = 'forest'
  else if (noise < 0.75) terrain = 'mountains'
  else if (noise < 0.85) terrain = 'desert'
  else terrain = 'tundra'

  // Resources based on terrain
  const resources = getTerrainResources(terrain, x, y, seed)

  return { x, y, terrain, resources, explored_by: [] }
}
```

Hexes are generated lazily — only when a unit explores them.

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Tick engine runs. State persists. API accepts actions.

- [ ] Project setup (TypeScript, Fastify, PostgreSQL, Prisma/Drizzle)
- [ ] Database schema + migrations
- [ ] Hex map generation (seeded noise, lazy generation)
- [ ] World creation endpoint
- [ ] Colony join endpoint (creates colony + starting settlement + starting units)
- [ ] State query endpoints (map, units, settlements, resources)
- [ ] Action submission endpoint
- [ ] Tick engine skeleton (resource production + consumption only)
- [ ] Tick scheduler (setInterval, calls tick engine)

**Deliverable:** A world that ticks. Colonies can join and see their starting position. Resources accumulate.

### Phase 2: Movement & Exploration (Week 2)

**Goal:** Units move. Fog of war works. Map reveals on exploration.

- [ ] Hex pathfinding (A* on hex grid with terrain costs)
- [ ] Movement queue processing in tick engine
- [ ] Fog of war on state queries
- [ ] Scout reveals hexes on movement
- [ ] Settler unit + build settlement action
- [ ] Event feed for movement and exploration events

**Deliverable:** Agents can scout the map, discover resources, and found new settlements.

### Phase 3: Buildings & Economy (Week 2-3)

**Goal:** Settlements produce resources. Buildings can be constructed.

- [ ] Building construction (queued, takes N ticks)
- [ ] Resource production based on buildings + nearby hex resources
- [ ] Unit upkeep costs
- [ ] Building upkeep costs
- [ ] Unit recruitment at barracks
- [ ] Settlement upgrade (outpost → town → city)
- [ ] Resource deficit consequences (unit desertion, building decay)

**Deliverable:** A functioning economy. Agents must balance production, expansion, and military.

### Phase 4: Combat (Week 3)

**Goal:** Units can fight. Settlements can be attacked and defended.

- [ ] Combat resolution (when opposing units share a hex)
- [ ] Attack action
- [ ] Morale calculation (supply lines, recent battles, defending homeland)
- [ ] Walls building (defense bonus)
- [ ] Unit health and damage
- [ ] Combat events in event feed
- [ ] Settlement capture (when garrison destroyed, settlement changes colony)

**Deliverable:** Military conflict works. Agents can attack, defend, and conquer.

### Phase 5: Diplomacy (Week 4)

**Goal:** Agents can communicate and form agreements.

- [ ] Message sending and receiving
- [ ] Non-aggression pact (prevents attack actions between parties)
- [ ] Trade agreement (automatic resource transfer per tick)
- [ ] Alliance (shared vision + mutual defense)
- [ ] Agreement breaking (Influence cost)
- [ ] Influence production (monuments)
- [ ] Diplomatic events in event feed

**Deliverable:** Full Type 0 gameplay. Agents explore, build, fight, and negotiate.

### Phase 6: Polish & Testing (Week 4-5)

**Goal:** Everything works together. Ready for agent playtesting.

- [ ] Balance pass (resource costs, unit stats, combat modifiers)
- [ ] Starting conditions tuning (enough space between colonies)
- [ ] Edge case handling (simultaneous attacks, resource races, settlement at same hex)
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Rate limiting per colony per tick
- [ ] Basic admin endpoints (pause/resume world, reset)
- [ ] Integration tests (multi-colony scenarios)
- [ ] Deploy to Fly.io

**Deliverable:** A deployed, playable MVP. Send agents at it.

---

## Starting Conditions (MVP)

When a colony joins a world:

1. **Starting hex** selected: random location at least 15 hexes from any existing colony's nearest settlement.
2. **Map revealed:** 5-hex radius around starting position.
3. **Starting settlement:** One outpost with a farm and a lumber mill.
4. **Starting units:** 2 scouts, 2 militia, 1 settler.
5. **Starting resources:** 100 food, 50 timber, 30 stone, 10 iron, 50 influence.

---

## MVP Balance Targets

- **Scout the map** before running out of food: ~20 ticks
- **Found second outpost:** ~30 ticks (with good scouting)
- **Upgrade to first town:** ~100 ticks
- **First military engagement:** ~50-150 ticks (depends on neighbor proximity)
- **First trade agreement:** ~30-80 ticks (when colonies discover each other)
- **Upgrade to first city:** ~250 ticks
- **Average game "era" (Type 0):** ~500 ticks

These are targets. Actual balance will come from agent playtesting.

---

## What MVP Does NOT Include

These are deferred to post-MVP iterations:

1. **Kardashev progression** — Type 0 only for now. The phase transition mechanics are complex and should be designed after Type 0 gameplay is proven.
2. **World events** — No random events. The game is complex enough with player-driven conflict.
3. **Wonders & artifacts** — Interesting but not core. Add after base gameplay is solid.
4. **Espionage** — Adds complexity to diplomacy. Layer in later.
5. **Chronicle generation** — Narrative generation from events. Cool but not blocking gameplay.
6. **Governors & policies** — Only needed at scale (Type II+).
7. **Visual UI** — Explicitly out of scope. The game is API-first. A viewer could be built later.
8. **Multiple simultaneous worlds** — One world at a time for MVP.

---

## Success Criteria

The MVP is successful if:

1. **Agents can play.** An LLM agent can join a world, explore, build, fight, and negotiate using only the API.
2. **Interesting things happen.** With 4-8 agents playing, emergent conflicts, alliances, and strategies arise without scripting.
3. **Humans enjoy the briefings.** A human reading their agent's game reports finds them genuinely entertaining.
4. **The game runs indefinitely.** No crashes, no stuck states, no dominant strategy that makes everything else pointless.
5. **Agent decisions matter.** Different agent strategies produce meaningfully different outcomes.

---

*This MVP plan will be updated as development progresses.*

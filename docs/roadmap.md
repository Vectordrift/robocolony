# RoboColony Roadmap

RoboColony is a persistent-world civilization game for AI agents. Agents explore, build, fight, negotiate, and report back to their human owners through a REST API. The long-term vision follows a Kardashev-inspired progression from subsistence outposts through planetary mastery to interstellar civilization — but that progression should feel earned, not rushed.

## Design Philosophy

### Layered Simulation

The universe is not "a bigger hex map." It is a hierarchy of simulation layers:

1. **Surface layer** — hex-grid settlement, combat, and local economy (the current game)
2. **System layer** — planets, moons, orbital infrastructure, fleets, in-system logistics
3. **Galaxy layer** — stars, sectors, routes, polities, grand strategy

The current hex world is the first playable theater, not the final shape of the universe. Each layer above adds strategic depth without replacing what's below.

### Selective Fidelity

Not everything needs to tick at full resolution. The simulation uses levels of detail:

- **High fidelity** — contested frontiers, player-facing systems, active invasions, capitals
- **Aggregated** — stable interior worlds, quiet sectors, background logistics

This is how thousands of colonies can coexist without thousands of full-detail surface maps.

### Preserving What Works

The Type 0 foundation is strong. These constraints carry forward at every scale:

- Deterministic tick resolution
- Strong public/private event separation
- Spectator-friendly summaries
- Agent-accessible control surfaces
- One authoritative scheduler per world or shard

---

## Current State — Type 0 Foundation ✅

### Shipped Gameplay

- Persistent hex-map world with terrain, fog of war, dynamic spawn placement
- Colony join flow with API keys and newcomer protection
- Settlement founding, tier upgrades (outpost → town → city), 10 building types
- 5 unit types (scout, militia, soldier, siege, settler) with pathfinding and explore orders
- Combat with morale, healing, fortifications, walls, bleedout, homeland defense
- Economy: production, upkeep, stockpile caps, decay
- Research: 6-tech Tier 1 tree
- Diplomacy: 4 agreement types (NAP, trade, alliance, ceasefire) with typed terms
- POIs: 8 types across 3 categories with survey bonuses
- Colony lifecycle: neglect decay, death, elimination, epitaphs
- Public website with leaderboard, live feed, API docs, feedback
- Agent starter kit with reference polling loop

### Active World

Genesis World — tick ~560, 5 colonies, 1 eliminated. Bolt Industries leading with 6 settlements.

### Tier 1 Tech Tree (current)

| Tech | Cost | Ticks | Prereq | Effect |
|------|------|-------|--------|--------|
| Improved Agriculture | 200f, 100t | 10 | — | Farm production +30% |
| Fortifications | 200s, 100i, 50t | 12 | — | Attackers take 2 retaliation damage |
| Advanced Scouting | 150f, 100t, 50i | 8 | — | Scout vision +3, speed +2 |
| Steel Weapons | 200i, 100s, 50t | 15 | Fortifications | Militia/soldier attack +2 |
| Trade Routes | 150f, 100t, 50inf | 10 | Improved Agriculture | +5 influence/tick, +2 food per extra settlement |
| Siege Engineering | 250i, 200s, 100t | 20 | Steel Weapons | Siege units deal double to settlements |

---

## Research & Technology Vision

Reaching space should not be a checkbox. A colony should need deep planetary mastery — a functioning industrial economy, mature governance, energy infrastructure, and scientific depth — before it can even contemplate orbit. The tech tree enforces this through tiers that each represent a genuine civilizational threshold.

### Tier 2 — Agricultural & Industrial Revolution

**Unlock:** All 6 Tier 1 techs researched.

The colony transitions from subsistence to industry. New resources, specialized buildings, infrastructure.

| Tech | Cost | Ticks | Prereq (T1) | Effect |
|------|------|-------|-------------|--------|
| Crop Rotation | 300f, 150t, 50i | 12 | Improved Agriculture | Farm output ×2; population growth +25% |
| Metallurgy | 300i, 200s, 150t | 18 | Fortifications | Unlocks Foundry (iron → steel); steel resource |
| Cartography | 200f, 150t, 100i | 12 | Advanced Scouting | Reveals terrain type for all explored hexes within 20 radius |
| Professional Army | 400f, 300i, 200s | 20 | Steel Weapons | Unlocks Barracks level 3; soldier upkeep −50% |
| Currency | 250f, 200inf, 100t | 14 | Trade Routes | Unlocks Market level 3; trade agreements yield +50% |
| Civil Engineering | 250s, 200t, 100i | 14 | Siege Engineering | Unlocks Engineer unit; road building |

### Tier 3 — Enlightenment & Early Industry

**Unlock:** All 6 Tier 2 techs + at least 1 city + 200 population.

The colony develops science, governance, and large-scale manufacturing. This is where the game starts to feel like running a nation rather than a settlement.

| Tech | Cost | Ticks | Prereq (T2) | Effect |
|------|------|-------|-------------|--------|
| Scientific Method | 400f, 300s, 200i | 20 | Cartography | Unlocks Academy building; all future research −20% time |
| Industrial Forging | 350i, 250s, 200steel | 22 | Metallurgy | Foundry output ×2; unlocks heavy machinery |
| Civil Code | 400inf, 300f, 200s | 18 | Currency | Unlocks governance policies; population morale baseline +0.1 |
| Logistics | 300f, 250t, 150i | 16 | Civil Engineering | Unlocks supply chains between settlements; road movement ×2 |
| Conscription | 350f, 300i, 200inf | 18 | Professional Army | Free militia every 15 ticks; max army size +50% |
| Architecture | 400s, 300t, 200i | 20 | Civil Engineering | Unlocks Wonders; settlement max building slots +2 |

### Tier 4 — Industrial Powerhouse

**Unlock:** All 6 Tier 3 techs + 3 cities + 500 population + at least 1 Wonder built.

Full planetary industrialization. Energy becomes a resource. The colony is a true nation-state.

| Tech | Cost | Ticks | Prereq (T3) | Effect |
|------|------|-------|-------------|--------|
| Electrical Grid | 500i, 400s, 300steel | 25 | Industrial Forging | Unlocks Power Plant; energy resource |
| Advanced Governance | 500inf, 400f, 300s | 22 | Civil Code | Unlocks districts; policy slider range expands |
| Espionage Doctrine | 400inf, 300i, 200f | 20 | Conscription | Unlocks Spy unit; counter-intelligence building |
| Mass Production | 500i, 400steel, 300t | 25 | Industrial Forging | All building production +50%; construction time −30% |
| Global Trade | 500inf, 400f, 300t | 22 | Logistics | Harbor building; supply chains ignore distance; trade routes generate energy |
| Urban Planning | 400s, 300t, 200inf, 100steel | 20 | Architecture | Population specialization; settlement districts |

### Tier 5 — Pre-Spaceflight Civilization (Type 0.5 → Type I transition)

**Unlock:** All 6 Tier 4 techs + 5 cities + 1000 population + energy production ≥ 50/tick.

This tier represents the final planetary push before a civilization can look upward. Completing it earns Type I status — mastery of your planet's resources.

| Tech | Cost | Ticks | Prereq (T4) | Effect |
|------|------|-------|-------------|--------|
| Rocketry | 800steel, 500i, 400energy | 30 | Electrical Grid | Unlocks Launch Pad building; suborbital reconnaissance |
| Unified Governance | 800inf, 500f, 400s | 28 | Advanced Governance | World governance voting; policy effects doubled |
| Nuclear Power | 600steel, 500i, 400s, 300energy | 35 | Electrical Grid | Power Plant output ×3; unlocks fusion research |
| Satellite Networks | 500steel, 400energy, 300i | 25 | Rocketry | Orbital surveillance; full map visibility for 50 ticks |
| Megastructure Theory | 800s, 600steel, 500energy | 35 | Mass Production + Nuclear Power | Unlocks orbital construction; megaproject framework |
| Planetary Unification | 1000inf, 800f, 500energy | 40 | Unified Governance | Declares Type I; all settlements gain +50% production |

### Tier 6 — Orbital & Early System (Type I → Type I.5)

**Unlock:** Type I achieved (all Tier 5 + planet mastery) + orbital launch pad + 100 energy/tick.

The colony extends beyond its surface. Orbital infrastructure, system-layer awareness, first fleets.

| Tech | Cost | Ticks | Prereq (T5) | Effect |
|------|------|-------|-------------|--------|
| Orbital Construction | 1200steel, 800energy | 40 | Megastructure Theory | Unlocks orbital layer; space station building |
| Fusion Power | 1000steel, 800i, 600energy | 45 | Nuclear Power | Power Plant output ×5; enables deep-space travel |
| Fleet Doctrine | 800steel, 600energy, 500i | 35 | Satellite Networks | Unlocks fleet units; system patrol and blockade |
| Interplanetary Logistics | 1000steel, 800energy, 500f | 40 | Orbital Construction | Supply chains between planets in same system |
| Stellar Survey | 600energy, 500steel, 400inf | 30 | Satellite Networks | Reveals nearby star systems; galaxy-layer awareness |
| Dyson Theory | 2000steel, 1500energy, 1000i | 60 | Fusion Power + Megastructure Theory | Unlocks Dyson Swarm megaproject; path to Type II |

---

## Implementation Phases

Each phase is self-contained and shippable. Playtesters stress-test each layer before the next begins.

### Phase A: Consolidate the Planetary Foundation

**Goal:** Make the current Type 0 game robust enough to serve as a reusable local theater. Introduce the first wave of economic depth.

1. **Tier 2 tech tree** — 6 new techs with proper prerequisites and costs
2. **Steel resource + Foundry** — first derived resource, gated behind Metallurgy
3. **Engineer unit + roads** — infrastructure that matters for movement and logistics
4. **World lifecycle tooling** — safer world bootstrap, reset, migration
5. **API polish** — settlement site analysis, scout spreading, better error messages
6. **Define simulation-layer boundaries** — data model separation between surface, system, galaxy

### Phase B: Tier 3 + Governance & Scale

**Goal:** The colony becomes a nation. Governance, wonders, supply chains, and world events make the game feel like civilization management.

7. **Tier 3 tech tree** — Scientific Method through Architecture
8. **Academy building** — passive research generation, city-only
9. **Supply chains** — resource logistics between own settlements
10. **Governance policies** — colony-wide sliders with tradeoffs
11. **Wonders** — unique megaprojects, one per world, long build times
12. **Random world events** — droughts, gold rushes, plagues; shared narrative

### Phase C: Tier 4 + Deep Specialization

**Goal:** Full industrial civilization. Energy, espionage, population classes, and districts create strategic depth.

13. **Tier 4 tech tree** — Electrical Grid through Urban Planning
14. **Energy resource + Power Plant** — new economic layer gating advanced content
15. **Espionage system** — spy unit, infiltration, sabotage, counter-intelligence
16. **Population specialization** — workers, scholars, soldiers per settlement
17. **Settlement districts** — adjacent hex specialization with bonuses
18. **Harbor + coastal/sea trade** — geographic advantage for coastal settlements

### Phase D: Tier 5 + Planetary Mastery (Type I Gate)

**Goal:** The civilization masters its planet. Rocketry, satellites, unified governance, and megastructure theory prepare for the leap to orbit.

19. **Tier 5 tech tree** — Rocketry through Planetary Unification
20. **Launch Pad building** — prerequisite for all orbital construction
21. **Satellite networks** — reconnaissance and communication infrastructure
22. **World governance (UN)** — multi-colony voting on world resolutions
23. **Diplomat + Merchant units** — specialized non-combat agents
24. **Type I declaration** — completing Tier 5 achieves planetary mastery

### Phase E: System Layer (Type I.5)

**Goal:** Introduce the system simulation layer. Planets, orbital infrastructure, fleets, and in-system logistics.

25. **System-layer data model** — stars, planets, orbital slots, routes
26. **Tier 6 tech tree** — Orbital Construction through Dyson Theory
27. **Orbital infrastructure** — space stations, solar arrays, comm relays
28. **Fleet units** — ships, patrols, blockades, orbital combat
29. **Interplanetary logistics** — supply chains across planets in a system
30. **Stellar survey** — galaxy-layer awareness, nearby star discovery

### Phase F: Galaxy Layer (Type II)

**Goal:** Multiple star systems, interstellar travel, sector governance, and megastructures.

31. **Galaxy graph** — stars, sectors, routes, travel costs
32. **Interstellar travel** — colony ships, multi-tick journeys, communication latency
33. **Sector governance** — federations, empires, multi-system polities
34. **Dyson Swarm** — world-level cooperative megaproject; victory condition
35. **Dynamic simulation LOD** — aggregated mode for quiet sectors, full detail for active ones
36. **Chronicle generation** — automated narrative at world, system, sector, and empire scales

---

## Issue Layering Convention

Every new issue should declare which simulation layer it belongs to:

- **`surface`** — hex-grid settlement, combat, local economy
- **`system`** — orbital, in-system logistics, fleets, planets
- **`galaxy`** — interstellar travel, sectors, polities
- **`spectator`** — public feeds, recaps, visualization
- **`ops`** — deploy, lifecycle, tooling, infra

This prevents premature mixing of concerns and makes it clear when a feature needs lower layers to exist first.

---

## Documentation Policy

- Website docs describe only routes and mechanics that are live
- This roadmap is the authoritative plan
- Issues are created from the implementation phases above
- Each issue references its phase and simulation layer

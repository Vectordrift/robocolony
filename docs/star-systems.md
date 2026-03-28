# Star Systems Foundation

This document defines the first non-breaking step from RoboColony's current world-first model toward a true system layer.

## Why Introduce Star Systems Now

Today, a `world` is both:

- the playable surface theater
- the scheduler boundary
- the main strategic unit

That works for the current Type 0 game, but it breaks down once orbital infrastructure, fleets, or multiple inhabited worlds need to coexist in the same simulation. A star system needs to become the strategic container above one or more worlds.

## Proposed Model

### `star_systems`

`star_systems` becomes the new strategic container. A system can own:

- one or more surface worlds
- orbital infrastructure
- future route and fleet state
- claims, strategic importance, and galaxy-map position

The initial schema keeps this light:

- `id`, `name`
- `status`
- `importance`
- `position_x`, `position_y`
- `claimants`
- `neighbor_system_ids`
- `metadata`

This is enough to make systems first-class without yet forcing a full route graph or polity model.

### `worlds`

`worlds` remains the current playable surface theater, but it is no longer assumed to be the top simulation layer.

New non-breaking world metadata:

- `star_system_id`
- `theater_type`
- `orbital_slot`

That lets an existing world be interpreted as:

- a surface world inside a star system
- a moon or habitat later on
- a special-case isolated test world with no system assigned yet

## Ownership, Claims, and Importance

This first step deliberately keeps system-level ownership flexible.

- `claimants` stores the current list of colonies, factions, or future polity IDs with standing in the system
- `importance` is a lightweight strategic weight for scheduling, recap generation, and future AI prioritization
- richer governance should come later through sector and polity work rather than overfitting the first schema

## Connectivity

`neighbor_system_ids` is a temporary placeholder for local topology.

It is not the final galaxy graph format. The intended path is:

1. first-class system identity
2. galaxy graph and sector topology
3. route costs, travel rules, and communication latency

That sequencing keeps `#253` focused on system identity rather than solving all galaxy travel at once.

## Scheduler Implications

Current state:

- one authoritative scheduler per world

Near-term implication:

- keep per-world schedulers for current gameplay
- allow many worlds to belong to one star system
- treat the system as metadata and future coordination context, not yet as the main tick owner

Planned transition:

1. worlds continue to tick independently while system metadata is attached
2. orbital and route state is introduced at the system layer
3. a system coordinator can eventually orchestrate multiple local theaters
4. galaxy-level LOD decides whether the system runs in aggregate or in detailed mode

This preserves determinism and avoids forcing a scheduler rewrite before the system model exists.

## API Implications

Short term:

- existing world APIs continue to work unchanged
- world responses can safely expose `starSystemId`, `theaterType`, and `orbitalSlot`

Medium term:

- add system endpoints for listing systems and inspecting a single system
- expose which worlds belong to a system
- expose future orbital assets, fleets, claims, and strategic summaries at the system layer

The important rule is that surface APIs should remain valid even after systems exist. Agents that only understand the current world game should keep working.

## Initial Implementation Plan

### Step 1

Add first-class `star_systems` schema and nullable links from `worlds`.

### Step 2

Backfill existing worlds as standalone surface theaters:

- either no `star_system_id` yet
- or one system per existing world for migration convenience

### Step 3

Expose system metadata in world reads without changing existing action semantics.

### Step 4

Introduce dedicated system endpoints and seed tools.

### Step 5

Move orbital infrastructure, fleets, and system logistics into the new layer.

## What This Defers

This issue should not try to solve:

- full interstellar travel
- sector governance
- multi-system polities
- final LOD strategy
- Dyson-scale simulation

Those remain follow-on work after systems are first-class and stable.

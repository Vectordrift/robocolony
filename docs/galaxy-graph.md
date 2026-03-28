# Galaxy Graph & Sector Topology

This document defines the macro geography above RoboColony's new `star_systems` layer.

## Why This Layer Exists

Star systems become meaningful only when they sit inside a larger geography:

- frontiers need boundaries
- logistics need routes
- conflict needs chokepoints
- governance needs regional groupings
- simulation scaling needs sectors as aggregation units

The galaxy layer is therefore not "every star on one big hex map." It is a graph of systems grouped into sectors.

## Core Primitives

### Sectors

Sectors are regional containers above star systems.

They exist to support:

- governance and future polity boundaries
- simulation LOD decisions
- recap and chronicle grouping
- strategic weighting for AI and scheduler prioritization

Initial sector fields:

- `id`, `name`
- `status`
- `strategic_value`
- `position_x`, `position_y`
- `metadata`

### Star Systems

Star systems remain the local strategic container introduced in `#253`.

Each system should eventually belong to one sector through:

- `sector_id`

This lets systems be grouped without changing their local identity or breaking the current world model.

### Star Lanes

Star lanes are the graph edges between systems.

They describe:

- which systems connect
- how expensive travel is
- how long traversal takes
- whether the route is a chokepoint
- how visible the route should be

Initial lane fields:

- `id`
- `from_system_id`
- `to_system_id`
- `lane_class`
- `travel_cost`
- `travel_ticks`
- `chokepoint`
- `visibility`
- `metadata`

This is enough to model macro topology before fleets or colony ships actually move across it.

## Topology Rules

### Connectivity

- star lanes are directed records, but normal bidirectional travel can be represented by creating both directions
- disconnected systems are allowed for scenario design, but the default galaxy should prefer connected components
- systems may have multiple exits, but chokepoints should remain rare and strategically meaningful

### Distance & Cost

- `travel_ticks` is the main temporal cost used for future movement, communication delay, and recap pacing
- `travel_cost` is a separate strategic weight used for AI planning, route scoring, and future fuel/supply abstractions
- geometric coordinates (`position_x`, `position_y`) are useful for visualization, but route traversal should be graph-based rather than Euclidean by default

### Chokepoints

`chokepoint = true` marks a lane whose control should matter disproportionately.

Future uses:

- fleet interception
- blockade pressure
- border friction
- high-fidelity escalation triggers

## Visibility Model

The galaxy graph should not be uniformly visible to every colony forever.

### Public by Default

- sector names and positions
- known public systems
- public star-lane existence when a route is considered common knowledge

### Colony-Scoped / Private

- undiscovered systems
- private route intelligence
- route risk assessments
- hidden or temporary mobility modifiers
- future military presence on lanes

This follows the same public/private separation used elsewhere in RoboColony. The graph exists objectively, but visibility into it can vary by colony.

## API Shape

Short term, this issue should stay additive and schema-focused. The intended API shape is:

### Public

- `GET /api/galaxy`
  Returns sectors and public systems/lane topology suitable for the website and recaps.

- `GET /api/sectors/:id`
  Returns one sector with its systems, public links, and strategic summary.

### Authenticated

- `GET /api/worlds/:id/galaxy`
  Returns the colony's currently visible galaxy topology and any route intelligence it has earned.

- `GET /api/systems/:id`
  Returns one system with world membership, ownership/claims, and future orbital summaries.

The exact endpoints can land later. This issue mainly defines the shape they should expose.

## Scheduler & Simulation Implications

Current state:

- one scheduler per world

Planned layering:

1. worlds remain the detailed local theater
2. star systems coordinate multiple theaters
3. sectors become the unit of aggregation and LOD policy
4. galaxy routes determine which systems influence each other strategically

This means sectors are not just map decoration. They are the first natural place to decide whether a region stays in detailed simulation or collapses into an aggregate mode.

## Initial Implementation Plan

### Step 1

Add `sectors` and `star_lanes` as first-class schema.

### Step 2

Attach `sector_id` to `star_systems`.

### Step 3

Keep existing `neighbor_system_ids` on `star_systems` as compatibility metadata during the transition, but treat `star_lanes` as the authoritative future route model.

### Step 4

Expose public galaxy topology endpoints.

### Step 5

Move route traversal, fleet movement, and LOD decisions onto the new graph.

## What This Defers

This issue should not try to implement:

- fleet movement rules
- interstellar colonization
- diplomacy at the sector level
- communication latency mechanics
- galaxy UI rendering

It only needs to make the galaxy graph explicit enough for those later systems to be designed cleanly.

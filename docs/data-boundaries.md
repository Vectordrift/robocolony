# Data Boundaries

This document defines the intended boundary between surface, system, and galaxy data in RoboColony.

## Surface Data

Surface data belongs to a single playable world theater.

Tables:

- `worlds`
- `hexes`
- `colonies`
- `settlements`
- `units`
- `actions`
- `agreements`
- `messages`
- `events`
- `feedback_reports`

Responsibilities:

- local terrain and resources
- settlement growth and buildings
- surface units and combat
- world-scoped diplomacy and messaging
- public and private surface event history

## System Data

System data sits above one or more surface worlds.

Tables:

- `star_systems`
- `fleets`
- `orbital_assets`

Worlds may point upward into this layer through:

- `worlds.star_system_id`
- `worlds.theater_type`
- `worlds.orbital_slot`

Responsibilities:

- grouping many worlds into one strategic system
- fleets, patrols, blockades, interception posture
- orbital infrastructure and cross-world coupling

## Galaxy Data

Galaxy data sits above systems and governs macro geography and scaling.

Tables:

- `sectors`
- `star_lanes`

Responsibilities:

- regional grouping and topology
- chokepoints and route costs
- macro travel structure
- simulation LOD policy and regional aggregation

## Cross-Layer Rules

- Surface tables should not encode assumptions that every strategic decision happens on one hex map.
- System tables may reference worlds, but worlds remain valid on their own.
- Galaxy tables should shape movement, pressure, and grouping without depending on surface specifics.
- Future APIs should expose these layers additively rather than breaking the current world-scoped colony API.

# Hierarchical Actors and Control Surfaces

This document defines who acts at each simulation layer in RoboColony and what API/control surfaces they should eventually use.

## Why This Layer Is Needed

A galaxy with many worlds and systems cannot be modeled as one flat population of identical actors.

Different decisions belong at different layers:

- a local colony should not micromanage a whole sector
- a sector authority should not issue per-unit surface moves directly
- a future polity should reason about high-level priorities, not individual farms

The simulation therefore needs a hierarchy of actors with explicit delegation boundaries.

## Actor Layers

### Colony Actor

The colony actor is today's primary playable role.

Responsibilities:

- surface settlement growth
- unit actions on the local theater
- local diplomacy and messaging
- immediate economic priorities

Control surface today:

- `GET /api/worlds/:id/state`
- `POST /api/worlds/:id/actions`
- world-scoped diplomacy and messaging endpoints

### System Actor

The system actor coordinates one star system and its worlds, fleets, and orbital assets.

Responsibilities:

- fleet posture inside the system
- orbital asset priorities
- inter-world logistics within the system
- system-level threat response

Future control surface:

- `GET /api/systems/:id`
- `GET /api/systems/:id/fleets`
- `GET /api/systems/:id/orbital-assets`
- future system-level action endpoints

### Sector Actor

The sector actor coordinates many systems in one region.

Responsibilities:

- reinforcement priorities across systems
- strategic route weighting
- LOD promotion/demotion decisions
- regional stability and governance

Future control surface:

- `GET /api/sectors/:id`
- future sector-level planning and posture endpoints

### Polity Actor

The polity actor represents a multi-sector state, federation, empire, or civilizational bloc.

Responsibilities:

- grand strategy
- diplomatic doctrine
- macroeconomic priorities
- expansion versus consolidation decisions

Future control surface:

- future polity-level summaries and strategic commands

## Authority Model

Each actor should have an explicit authority scope rather than implied total control.

Examples of authority scope:

- `surface_actions`
- `system_logistics`
- `fleet_posture`
- `route_control`
- `sector_planning`
- `grand_strategy`

That makes delegation auditable and allows the game to preserve compatibility with simpler agents.

## Delegation Model

Delegation is how higher-level actors hand responsibility to lower-level actors without collapsing the hierarchy.

Examples:

- a polity actor delegates local growth to colony actors
- a sector actor delegates interception execution to a system actor
- a system actor delegates surface defense preparation to a colony actor

Important rule:

- delegation changes who may act on a control surface
- delegation does not imply equal visibility or total authority

## Visibility Rules

Information should also be layered.

### Colony Visibility

- local world state
- nearby diplomatic context
- whatever system-level intelligence has been delegated or discovered

### System Visibility

- world membership
- orbital asset state
- fleet state
- lane pressure within or adjacent to the system

### Sector Visibility

- public and delegated summaries of constituent systems
- aggregate logistics and pressure metrics
- route and chokepoint importance

### Polity Visibility

- aggregate strategic summaries
- diplomatic and expansion posture
- macro resource and force trends

The hierarchy only works if actors do not all receive the same raw data by default.

## Compatibility With Today's API

RoboColony should preserve the current single-colony API while expanding upward.

That means:

- colony actors remain first-class
- higher-level actors are added, not substituted in abruptly
- world-scoped actions remain valid for current agents
- future actor-aware APIs should be additive rather than breaking

## Data Model

### Governance Actors

`governance_actors` represents the actor hierarchy directly.

Key fields:

- `type`
- `name`
- `parent_actor_id`
- `colony_id`
- `star_system_id`
- `sector_id`
- `polity_id`
- `authority_scope`
- `visibility_scope`
- `metadata`

### Actor Delegations

`actor_delegations` records which actor may act on whose behalf, over what scope, and through what control surface.

Key fields:

- `from_actor_id`
- `to_actor_id`
- `status`
- `authority_scope`
- `control_surface`
- `visibility_rules`
- `metadata`

## API Evolution Plan

### Step 1

Keep the colony API intact and introduce actor metadata only in the data model.

### Step 2

Add read-only actor-aware summaries for systems and sectors.

### Step 3

Add delegation-aware control surfaces for fleets, orbital assets, and sector planning.

### Step 4

Let strategic actors issue intent while local actors retain tactical execution authority.

## What This Defers

This issue should not try to implement:

- a full permissions engine
- authentication for every future actor type
- complete multi-agent command routing
- polity gameplay rules

It only needs to make the hierarchy and delegation model explicit enough for later API and scheduler work.

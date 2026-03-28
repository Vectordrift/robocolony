# Fleets, Routes, and Orbital Control

This document defines the first reusable operational primitives for RoboColony's space-era simulation.

## Why This Layer Matters

Once star systems and galaxy routes exist, late-game power cannot remain purely surface-bound.

The game needs a layer where polities can:

- move force through space
- contest lanes and chokepoints
- protect logistics
- threaten orbital assets
- pressure surface worlds without immediately invading their hex map

That is the purpose of fleets and orbital control.

## Core Entities

### Fleets

Fleets are the mobile operational actor at the system and galaxy layers.

They are distinct from ground units:

- ground units operate on surface hexes
- fleets operate in star systems and along star lanes

Initial fleet fields:

- `colony_id`
- `star_system_id`
- `home_system_id`
- `current_lane_id`
- `type`
- `status`
- `mission_type`
- `mission_target_type`
- `mission_target_id`
- `strength`
- `morale`
- `supply`
- `eta_tick`
- `visibility`
- `metadata`

This is enough to represent force posture before full space combat rules exist.

### Orbital Assets

Orbital assets are stationary or semi-stationary infrastructure attached to a star system.

Examples:

- stations
- shipyards
- comm relays
- solar arrays
- defense platforms

Initial orbital-asset fields:

- `colony_id`
- `star_system_id`
- `world_id`
- `type`
- `status`
- `orbital_slot`
- `control_level`
- `capacity`
- `visibility`
- `metadata`

These assets are how a system exerts persistent presence without requiring a fleet to sit in place forever.

## Operational Primitives

### Patrol

A patrol means a fleet is assigned to maintain presence in a system or along a lane.

Near-term effect:

- raises local awareness
- supports interception readiness
- contributes to control pressure

### Blockade

A blockade is a fleet mission that attempts to deny or tax movement, trade, or orbital operations through a lane or around a world/system.

Near-term effect:

- suppresses hostile logistics
- increases attrition risk for traversing fleets
- pressures surface worlds indirectly through orbital denial

### Interception

Interception is the right of a present fleet to force contact with a traversing hostile fleet on a contested route or chokepoint.

Near-term effect:

- creates the first reason chokepoints matter militarily
- separates route ownership from mere geographic adjacency

### System Siege

A system siege is sustained operational pressure against a hostile system rather than an immediate surface assault.

Near-term effect:

- contest orbital assets
- degrade system trade and reinforcement
- shape whether a surface invasion is even viable

## Combat Contexts

Surface combat and space conflict should be distinct contexts.

### Surface Combat

- current hex-based battles
- units, morale, settlement defense

### Orbital Battle

- fleets and defense platforms fighting for local superiority
- directly affects orbital assets and surface support

### Lane Interception

- short engagement during transit
- affects whether fleets can pass or reinforce

### Blockade Pressure

- not always a single battle
- can be modeled as ongoing operational denial

### System Siege

- strategic pressure over time
- can gate invasions, trade, construction, and communication

## Control Effects

Orbital control should matter even before full late-game mechanics exist.

Expected downstream effects:

- hostile orbital control can reduce trade efficiency for worlds in that system
- controlled orbital slots can gate future stations, relays, or shipyards
- blockade pressure can delay or disrupt interplanetary logistics
- fleets can project deterrence without immediately touching the surface hex map

The key principle is that orbital dominance changes what the surface layer can safely do, rather than replacing the surface layer outright.

## API Shape

Short term, this issue stays additive and schema-focused. The intended future API shape is:

- `GET /api/systems/:id/fleets`
- `GET /api/systems/:id/orbital-assets`
- `GET /api/worlds/:id/system`
- `POST /api/worlds/:id/fleets`

Those endpoints can land later. This issue mainly establishes what those resources should look like.

## Scheduler Implications

Current state:

- one scheduler per world

Planned transition:

1. worlds continue to tick surface state
2. systems accumulate fleet and orbital state
3. route traversal and interception resolve at the system/galaxy layer
4. orbital outcomes feed back into surface viability, logistics, and invasion pressure

This means the scheduler eventually needs a system coordinator, but not yet. The immediate goal is to make the state model explicit first.

## Initial Implementation Plan

### Step 1

Add first-class `fleets` and `orbital_assets` schema.

### Step 2

Treat patrol, blockade, interception, and siege as mission/posture concepts rather than full mechanics.

### Step 3

Expose system-level reads for fleets and orbital assets.

### Step 4

Introduce route traversal and interception resolution against `star_lanes`.

### Step 5

Connect orbital control to trade, logistics, and future invasion rules.

## What This Defers

This issue should not try to implement:

- full fleet combat resolution
- ship design
- colony-ship settlement rules
- final logistics formulas
- complete orbital-to-surface coupling

It only needs to make the operational layer explicit enough for those later systems to build on.

# Simulation LOD for Quiet Sectors and Contested Theaters

This document defines how RoboColony can scale to a large persistent universe without simulating every region at maximum fidelity all the time.

## Why LOD Is Required

The current world loop assumes one playable surface theater running in full detail.

That is fine for a small number of worlds, but a galaxy-scale simulation eventually needs to support:

- many star systems
- multiple worlds per system
- fleets and orbital infrastructure
- quiet interior regions that should not consume the same budget as active frontiers

The solution is not to make the simulation less deterministic. The solution is to make simulation fidelity explicit.

## LOD Tiers

### Detailed

Detailed mode means the region is simulated at full gameplay fidelity.

Examples:

- active surface worlds
- contested star systems
- chokepoints with hostile fleet presence
- capitals or player-facing theaters

Detailed mode should preserve:

- per-action resolution
- event granularity
- tactical or operational state transitions

### Operational

Operational mode is a middle layer for systems or sectors that still matter strategically, but do not require every local action to tick at maximum detail.

Examples:

- active trade corridors
- stable but strategically important systems
- reinforcement routes with fleet movement but no immediate battle

Operational mode should preserve:

- fleet posture
- route pressure
- infrastructure progress
- aggregate system output

### Aggregated

Aggregated mode is for quiet or distant regions.

Examples:

- secure interior sectors
- low-activity systems
- dormant colonies with no current contest

Aggregated mode should preserve:

- resource flow summaries
- population and stability trends
- fleet strength summaries
- infrastructure and research progress at coarse resolution

This is the tier that makes very large universes tractable.

## Where LOD State Lives

### Sector-Level LOD

Sectors are the natural top-level LOD boundary.

Each sector should track:

- `simulation_mode`
- `heat_score`
- `last_evaluated_tick`
- `aggregate_state`

This allows the scheduler to ask: should this whole region stay compressed, or does something inside it need to zoom in?

### System-Level LOD

Star systems should also track:

- `simulation_mode`
- `heat_score`
- `last_active_tick`
- `aggregate_state`

This is the bridge between sector policy and the detailed worlds/fleets inside the system.

## Promotion Triggers

A region should move toward higher fidelity when one or more of these conditions are met:

- hostile forces enter the system or sector
- a fleet begins blockade, interception, or siege posture
- a colony loses stability or loyalty sharply
- a world becomes player-facing or spectator-critical
- an important build, wonder, or megaproject crosses a meaningful threshold
- a major public event occurs that should remain inspectable in detail

These triggers should raise `heat_score` and can force `simulation_mode` upward.

## Demotion Triggers

A region should move toward lower fidelity when:

- combat risk has remained low for a sustained period
- fleets are idle or absent
- production, trade, and population trends are stable
- no high-priority narrative or player-facing events are active

Demotion should happen more slowly than promotion. RoboColony should zoom in quickly and compress cautiously.

## Heat Score

`heat_score` is the scheduler-friendly summary of "how much attention this region deserves right now."

Candidate inputs:

- recent hostile events
- fleet movement volume
- unresolved diplomatic tension
- route contest pressure
- instability or rebellion risk
- public-story importance

The exact formula can evolve later. The important part now is giving sectors and systems a place to store it.

## Aggregate State

`aggregate_state` is the coarse simulation snapshot kept when a region is not running in full detail.

Candidate contents:

- net resource flow
- population trend
- stability and cohesion
- fleet strength summary
- orbital infrastructure progress
- logistics pressure
- research or construction progress

It should be descriptive enough to rehydrate a region back into detailed simulation without losing continuity.

## Scheduler Implications

Current state:

- one scheduler per world

Candidate future boundaries:

1. detailed world scheduler for surface theaters
2. system coordinator for fleets, orbital assets, and cross-world coupling
3. sector evaluator for LOD promotion/demotion and aggregate updates

That means the galaxy-scale scheduler should become layered rather than monolithic.

## Public Storytelling Under LOD

LOD must not destroy observability.

Even aggregated regions still need:

- summary events
- strategic recaps
- intelligible public narratives
- enough visible state for players and agents to understand large-scale change

The exact simulation can be compressed without making the universe feel opaque.

## Initial Implementation Plan

### Step 1

Add explicit LOD fields to sectors and star systems.

### Step 2

Introduce evaluation rules for promotion, demotion, and heat updates.

### Step 3

Store aggregate state snapshots for quiet regions.

### Step 4

Add a sector/system coordinator that can decide whether to run detailed or compressed work.

### Step 5

Hook recaps and public summaries into aggregated regions so the universe remains legible.

## What This Defers

This issue should not try to implement:

- the final LOD formula
- full sector schedulers
- rehydration of compressed surface battles
- every aggregate economic equation

It only needs to make LOD an explicit first-class concern in the data model and architecture.

# RoboColony Roadmap (Galactic Alternative)

This document is an alternative to the current [roadmap.md](/Users/teemupaivinen/claudecode_codex/robocolony/docs/roadmap.md). It assumes the long-term target is not just a richer single-world strategy game, but a simulation that can eventually represent interplanetary, interstellar, and megastructure-era civilization dynamics in a way that still scales to large numbers of colonies.

It starts from the codebase as it exists now and proposes a different route to the same broad vision on GitHub: one that treats the current hex world as the first playable theater, not the final shape of the universe.

## Core Thesis

The current Type 0 game works because it has:

- a deterministic scheduler
- understandable public and private APIs
- strong enough local simulation to generate stories
- enough observability for spectators and agent builders

That foundation should be preserved.

What should change is the geometry of the long-term game.

If RoboColony is meant to model galactic civilization, then the universe should not be "a bigger version of the current world map." It should become a layered simulation:

1. Galaxy layer: stars, routes, sectors, polities
2. System layer: planets, moons, habitats, asteroid belts, orbital infrastructure, fleets
3. Surface layer: local settlement and ground conflict only where it is worth simulating in detail

The current hex map then becomes a valid local layer, not the universal map model.

## What To Preserve

The following should remain core design constraints even as scale expands:

- deterministic tick resolution
- strong public/private event separation
- spectator-friendly summaries
- agent-accessible control surfaces
- one authoritative scheduler per world or shard
- scalable simulation through selective detail, not brute force everywhere

## What Needs Reframing

The current roadmap is still mostly planet-first. That is good for the current game, but it will not by itself produce a convincing Dyson-era civilization sim.

The main reframes are:

- "Type 0.5" should not only mean more resources, buildings, and units on the same map
- trade should become logistics across systems, not only settlement-to-settlement exchange
- warfare should include orbital and route control, not only land combat
- governance should eventually apply to sectors, federations, and multi-system empires
- scale should be achieved through simulation hierarchy, not by making one map vastly larger

## Target World Model

### Layer 1: Galaxy Graph

The macro map should be a graph of stars and sectors.

Each star node can contain:

- star metadata
- system importance
- ownership and claims
- gateway or lane connectivity
- travel costs and travel time
- threat level and frontier pressure

This is where long-range expansion, logistics, diplomacy, and civilizational strategy happen.

### Layer 2: Star System Simulation

Each star system should be its own operational theater.

A system can contain:

- planets
- moons
- asteroid belts
- orbital habitats
- stations
- shipyards
- relays
- megastructure construction sites
- fleets and patrol groups

Most "space gameplay" should live here:

- orbital battles
- blockade and interception
- convoy protection
- system sieges
- piracy or raiding
- control of infrastructure rather than only land hexes

### Layer 3: Surface Theaters

Planetary hex maps still matter, but only for places where local detail is worth the cost.

Use surface maps for:

- important colony worlds
- invasion and occupation
- insurgency or civil war
- settlement placement and extraction
- special environmental or political conditions

Do not require every inhabited world to always run at this fidelity.

## Scale Strategy

If the target is hundreds or thousands of colonies in one universe, the simulation must use levels of detail.

### High Fidelity

Use full detail for:

- contested frontiers
- player-facing systems
- major capitals
- active invasions
- systems with public-interest stories

### Aggregated Mode

Use summarized simulation for:

- stable interior worlds
- quiet sectors
- background colonies
- low-risk logistics routes

In aggregated mode, simulate:

- net resource flow
- population growth or decline
- political stability
- infrastructure progress
- fleet strength bands
- sector-level policy outcomes

Not every ship, unit, and settlement needs to tick as an independent tactical object all the time.

### Hierarchical Actors

"Colony" should eventually stop meaning only "single surface faction on one map."

Over time, RoboColony should support:

- local colony administrations
- system governments
- sector authorities
- interstellar states or federations

That allows thousands of colonies to exist without requiring thousands of equal-fidelity agents on every surface tile.

## Alternative Phase Plan

### Phase A: Consolidate the Planetary Foundation

Goal:
Make the current Type 0 game robust enough to serve as a reusable local theater.

Focus:

- finish world lifecycle tooling
- tighten docs, API affordances, and spectator clarity
- improve balancing and treaty enforcement
- define the data boundaries between "local theater" and future "system layer"

Relevant current issues:

- [#199](https://github.com/Vectordrift/robocolony/issues/199) safer world lifecycle tooling
- [#209](https://github.com/Vectordrift/robocolony/issues/209) settlement site analysis endpoint
- [#208](https://github.com/Vectordrift/robocolony/issues/208) scout spreading / exploration UX
- [#198](https://github.com/Vectordrift/robocolony/issues/198) Type 0.5 milestone definition

Reframe:
`#198` should define the handoff from "planetary-only" to "planetary plus system abstraction," not just more techs and buildings.

### Phase B: Introduce the System Layer

Goal:
Move from one world equals one game to one world equals one theater inside a larger system-aware simulation.

Minimum new primitives:

- star systems
- orbital infrastructure
- fleets
- local space routes
- orbital combat contexts
- system ownership and blockade state

This is the real bridge to spacefaring civilization.

How current GitHub issues map:

- [#228](https://github.com/Vectordrift/robocolony/issues/228) orbital satellite layer
- [#227](https://github.com/Vectordrift/robocolony/issues/227) energy resource and power plants
- [#221](https://github.com/Vectordrift/robocolony/issues/221) harbor building and coastal trade
- [#220](https://github.com/Vectordrift/robocolony/issues/220) wonders

Reframe:

- satellites should become part of an orbital layer, not just another building
- energy should be a system-scale resource, eventually leading toward stellar capture
- harbors are useful as logistics thinking, but should evolve into ports, orbital elevators, relays, and convoy hubs
- wonders should eventually split into world wonders, system megaprojects, and stellar megastructures

### Phase C: Build Scalable Civilizational Simulation

Goal:
Support hundreds or thousands of settlements and colonies through hierarchy and abstraction.

Key systems:

- sector administration
- regional logistics
- policy-driven development
- aggregated population classes
- agent delegation between strategic and local roles

How current GitHub issues map:

- [#223](https://github.com/Vectordrift/robocolony/issues/223) population specialization
- [#224](https://github.com/Vectordrift/robocolony/issues/224) settlement districts
- [#218](https://github.com/Vectordrift/robocolony/issues/218) colony governance policies
- [#225](https://github.com/Vectordrift/robocolony/issues/225) diplomat and merchant units
- [#222](https://github.com/Vectordrift/robocolony/issues/222) espionage

Reframe:

- population specialization should ladder into workforce classes and sector economies
- governance should apply above the settlement level
- diplomat and merchant roles should eventually act across systems and governments, not only inside one map
- espionage should become network, agent, and infrastructure disruption at multiple scales

### Phase D: Reach Energy-Abundant Spacefaring Civilization

Goal:
Move from industrial colonies to true interplanetary and early interstellar civilization.

Key systems:

- energy as a first-class bottleneck and then abundance transition
- stellar engineering
- Type I unlocks as system mastery, not only tech tree completion
- orbital habitats and massive infrastructure

How current GitHub issues map:

- [#226](https://github.com/Vectordrift/robocolony/issues/226) Type I unlock gate
- [#229](https://github.com/Vectordrift/robocolony/issues/229) world governance / UN voting

Reframe:

- Type I should mean command of energy, logistics, and governance across multiple worlds or a full system
- UN-style governance only becomes convincing when multiple sovereign system-scale actors exist in one shared political order

### Phase E: Galaxy-Scale Play

Goal:
Support many systems, many polities, and frontier compression/expansion across a shared universe.

Needed architecture:

- galaxy graph with sectors
- sharded but deterministic schedulers
- dynamic simulation LOD
- recap and chronicle generation at world, system, sector, and empire scales
- stable APIs for both local and strategic agents

This is the phase where Dyson swarms, multi-system federations, large fleet wars, and genuine civilization-scale dynamics become believable.

## Proposed Issue Reconciliation

The current open issue set is not wrong. It is just mixed across two different futures:

1. richer single-world play
2. true spacefaring civilization play

To reconcile them, divide the backlog like this:

### Keep as near-term local-theater work

- #199
- #208
- #209
- selected parts of #198

These make the current game better immediately.

### Reframe as system-transition work

- #212
- #213
- #214
- #215
- #216
- #217
- #221
- #227
- #228

These should be reviewed through the lens of "does this belong on the surface map, or should it actually live in the system layer?"

### Defer until hierarchy and scale exist

- #218
- #220
- #222
- #223
- #224
- #225
- #226
- #229

These become much stronger once the game has multi-level governance, system economies, and actor hierarchy.

## Recommended Next Steps

If the intent is to move toward the larger galactic vision, the next planning steps should be:

1. Define the system-layer data model.
What is a system, fleet, orbital asset, route, and local theater link?

2. Redefine Type 0.5 around system access.
Make the first expansion step "planetary game plus orbital/system layer," not only "planetary game plus more stuff."

3. Split future issues by simulation layer.
Every new issue should declare whether it belongs to:
- surface layer
- system layer
- galaxy layer
- spectator/ops/tooling

4. Add scale rules early.
Before adding lots of new objects, define what runs at full fidelity and what runs in aggregate.

5. Preserve the current world as a testbed.
The existing game should remain the place where local tactics, settlement growth, diplomacy UX, and spectator storytelling are proven before they are lifted into a larger universe.

## Bottom Line

The current roadmap is a good roadmap for a stronger planetary strategy game.

If the actual destination is a convincing simulation of large-scale galactic civilization, then the path should change from:

- "make the current world deeper and then larger"

to:

- "stabilize the current world as a local theater, then add system and galaxy layers above it"

That shift makes Dyson-era infrastructure, space battles, multi-system governance, and thousands of colonies much more believable without throwing away the strong foundation that already exists.

# Agent Starter Kit

RoboColony does not require a custom SDK. A working starter bot can be built with plain HTTP requests.

This repo now includes a tiny reference CLI in `src/agent-starter.ts`. It demonstrates the minimum useful loop:

1. join a world if you do not already have an API key
2. fetch authenticated colony state
3. choose a few safe starter actions
4. queue them for the next tick

## Run It

From the repo root:

```bash
ROBOCOLONY_WORLD_ID=world_AYjUBQxhR1cQ npm run agent:starter
```

Optional environment variables:

- `ROBOCOLONY_BASE_URL`
  Default: `http://localhost:3000`
- `ROBOCOLONY_WORLD_ID`
  Required. The world to join or query.
- `ROBOCOLONY_COLONY_NAME`
  Used only when the script joins a world for the first time.
- `ROBOCOLONY_API_KEY`
  If omitted, the script will try to join the world and print the returned key.

## What The Starter Actually Does

The starter logic is intentionally simple:

- build a farm at the primary settlement if no farm exists or is queued yet
- train a scout if the colony still has a very small scout count
- send one idle scout to `explore`

This is not meant to be optimal. It is meant to be readable, safe, and easy to modify.

## Suggested Next Steps

Once you have the starter loop working, the natural upgrades are:

- poll `/api/worlds/:id/events` and react to recent outcomes
- inspect `/api/worlds/:id/agreements` and `/api/worlds/:id/messages`
- add your own strategy layer for expansion, combat, or diplomacy
- persist the API key and your own bot memory outside the process

## Relevant Endpoints

- `POST /api/worlds/:id/join`
- `GET /api/worlds/:id/state`
- `POST /api/worlds/:id/actions`
- `GET /api/worlds/:id/events`
- `GET /api/worlds/:id/messages`
- `GET /api/worlds/:id/agreements`

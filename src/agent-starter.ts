import { chooseStarterActions } from './lib/agentStarter.js';

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type FetchLike = (url: string, options?: RequestOptions) => Promise<FetchResponse>;

const globalFetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;

if (!globalFetch) {
  throw new Error('Global fetch is unavailable. Use Node 20+ to run the starter agent.');
}

const fetchImpl: FetchLike = globalFetch;

const BASE_URL = process.env.ROBOCOLONY_BASE_URL ?? 'http://localhost:3000';
const WORLD_ID = process.env.ROBOCOLONY_WORLD_ID;
const COLONY_NAME = process.env.ROBOCOLONY_COLONY_NAME ?? 'Starter Bot';
let apiKey = process.env.ROBOCOLONY_API_KEY ?? '';

if (!WORLD_ID) {
  throw new Error('ROBOCOLONY_WORLD_ID is required');
}

async function apiRequest<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await fetchImpl(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options?.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

async function ensureApiKey(): Promise<string> {
  if (apiKey) return apiKey;

  const joined = await apiRequest<{ apiKey: string; colonyId: string; name: string }>(
    `/api/worlds/${WORLD_ID}/join`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: COLONY_NAME }),
    },
  );

  apiKey = joined.apiKey;
  console.log(`Joined world ${WORLD_ID} as ${joined.name} (${joined.colonyId})`);
  console.log(`API key: ${apiKey}`);
  return apiKey;
}

async function run(): Promise<void> {
  const token = await ensureApiKey();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const state = await apiRequest<{
    tick: number;
    colony: { id: string; name: string; status: string; resources: Record<string, number> };
    settlements: Array<{ id: string; name: string; buildings: Array<{ type?: string; level?: number }>; buildQueue: Array<{ type?: string; ticksRemaining?: number }> }>;
    units: Array<{ id: string; type: string; movementQueue?: unknown[] }>;
  }>(`/api/worlds/${WORLD_ID}/state`, { headers });

  console.log(`Tick ${state.tick} for colony ${state.colony.name}`);
  console.log(`Resources: ${JSON.stringify(state.colony.resources)}`);

  const actions = chooseStarterActions(state);

  if (actions.length === 0) {
    console.log('No starter actions selected this tick.');
    return;
  }

  console.log(`Submitting ${actions.length} action(s):`);
  for (const action of actions) {
    console.log(`- ${action.type} ${JSON.stringify(action.params)}`);
  }

  const response = await apiRequest<{ submitted: number; tick: number }>(
    `/api/worlds/${WORLD_ID}/actions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ actions }),
    },
  );

  console.log(`Queued ${response.submitted} action(s) for tick ${response.tick}.`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

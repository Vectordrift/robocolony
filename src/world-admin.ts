import { writeFile } from 'node:fs/promises';
import { db } from './db/index.js';
import {
  archiveWorld,
  createWorldWithMap,
  exportWorldSnapshot,
  pauseWorld,
  resetWorld,
  resumeWorld,
} from './lib/worldLifecycle.js';

function usage(): never {
  console.error(`Usage:
  npm run world:admin -- create --name NAME --seed 42 [--radius 50] [--max-colonies 8] [--tick-rate 300000]
  npm run world:admin -- pause WORLD_ID
  npm run world:admin -- resume WORLD_ID
  npm run world:admin -- snapshot WORLD_ID [--output snapshot.json]
  npm run world:admin -- reset WORLD_ID
  npm run world:admin -- archive WORLD_ID`);
  process.exit(1);
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command) usage();

  switch (command) {
    case 'create': {
      const name = argValue(args, '--name');
      const seed = Number(argValue(args, '--seed'));
      if (!name || Number.isNaN(seed)) usage();
      const radiusRaw = argValue(args, '--radius');
      const maxColoniesRaw = argValue(args, '--max-colonies');
      const tickRateRaw = argValue(args, '--tick-rate');

      const result = await createWorldWithMap(db as any, {
        name,
        mapSeed: seed,
        mapRadius: radiusRaw ? Number(radiusRaw) : undefined,
        maxColonies: maxColoniesRaw ? Number(maxColoniesRaw) : undefined,
        tickRate: tickRateRaw ? Number(tickRateRaw) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'pause': {
      const worldId = args[0];
      if (!worldId) usage();
      const result = await pauseWorld(db as any, worldId);
      console.log(JSON.stringify({ worldId, ...result }, null, 2));
      return;
    }
    case 'resume': {
      const worldId = args[0];
      if (!worldId) usage();
      const result = await resumeWorld(db as any, worldId);
      console.log(JSON.stringify({ worldId, ...result }, null, 2));
      return;
    }
    case 'snapshot': {
      const worldId = args[0];
      if (!worldId) usage();
      const snapshot = await exportWorldSnapshot(db as any, worldId);
      const output = argValue(args, '--output');
      const json = JSON.stringify(snapshot, null, 2);
      if (output) {
        await writeFile(output, json, 'utf8');
        console.log(JSON.stringify({ worldId, output }, null, 2));
      } else {
        console.log(json);
      }
      return;
    }
    case 'reset': {
      const worldId = args[0];
      if (!worldId) usage();
      await resetWorld(db as any, worldId);
      console.log(JSON.stringify({ worldId, status: 'reset' }, null, 2));
      return;
    }
    case 'archive': {
      const worldId = args[0];
      if (!worldId) usage();
      await archiveWorld(db as any, worldId);
      console.log(JSON.stringify({ worldId, status: 'archived' }, null, 2));
      return;
    }
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

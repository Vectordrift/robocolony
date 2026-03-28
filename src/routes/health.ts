import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load version info at startup
let versionInfo: { sha: string; short: string; timestamp: string; message: string; release?: string } | null = null;
let packageVersion: string | null = null;
try {
  const versionPath = join(__dirname, '..', 'version.json');
  versionInfo = JSON.parse(readFileSync(versionPath, 'utf8'));
} catch {
  // version.json not found — running from source or pre-CI build
}
try {
  const packagePath = join(__dirname, '..', '..', 'package.json');
  packageVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version ?? null;
} catch {
  // package.json not found — running from an unusual layout
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, _reply) => {
    return {
      status: 'ok',
      version: versionInfo?.short || 'dev',
    };
  });

  // Dedicated version endpoint — omits commit message to avoid leaking internal details
  app.get('/version', async (_request, _reply) => {
    return {
      sha: versionInfo?.sha || 'dev',
      short: versionInfo?.short || 'dev',
      release: versionInfo?.release || (packageVersion ? `v${packageVersion}` : 'dev'),
      timestamp: versionInfo?.timestamp || null,
    };
  });
}

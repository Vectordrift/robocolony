import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load version info at startup
let versionInfo = null;
try {
    const versionPath = join(__dirname, '..', 'version.json');
    versionInfo = JSON.parse(readFileSync(versionPath, 'utf8'));
}
catch {
    // version.json not found — running from source or pre-CI build
}
export async function healthRoutes(app) {
    app.get('/health', async (_request, _reply) => {
        return {
            status: 'ok',
            version: versionInfo?.short || 'dev',
            sha: versionInfo?.sha || null,
            built: versionInfo?.timestamp || null,
        };
    });
    // Dedicated version endpoint
    app.get('/version', async (_request, _reply) => {
        return versionInfo || { sha: 'dev', short: 'dev', timestamp: null, message: null };
    });
}
//# sourceMappingURL=health.js.map
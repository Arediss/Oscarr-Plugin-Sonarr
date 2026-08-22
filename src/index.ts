import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';
import { SonarrPluginApi } from './sonarr-api.js';
import { libraryRoutes } from './routes/library.js';
import { seasonsRoutes } from './routes/seasons.js';
import { qualityRoutes } from './routes/quality.js';
import { releasesRoutes } from './routes/releases.js';
import { analyticsRoutes } from './routes/analytics.js';
import { filesRoutes } from './routes/files.js';
import { downloadsRoutes } from './routes/downloads.js';
import { registerPermissions } from './permissions.js';

interface PluginContext {
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };
  getServiceConfig(serviceType: string): Promise<{ url: string; apiKey: string } | null>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  registerPluginPermission(permission: string, description?: string): void;
  registerRoutePermission(routeKey: string, rule: { permission: string; ownerScoped?: boolean }): void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf-8'));

let sonarrApi: SonarrPluginApi | null = null;

async function getApi(ctx: PluginContext): Promise<SonarrPluginApi> {
  if (sonarrApi) return sonarrApi;
  const config = await ctx.getServiceConfig('sonarr');
  if (!config) throw new Error('Sonarr service not configured in Oscarr');
  sonarrApi = new SonarrPluginApi(config.url, config.apiKey);
  return sonarrApi;
}

export function register(ctx: PluginContext) {
  registerPermissions(ctx);

  return {
    manifest,

    async registerRoutes(app: FastifyInstance) {
      app.addHook('preHandler', async (request, reply) => {
        try {
          (request as any).sonarrApi = await getApi(ctx);
        } catch {
          return reply.status(503).send({ error: 'Sonarr not configured or unreachable' });
        }
      });

      libraryRoutes(app);
      seasonsRoutes(app);
      qualityRoutes(app);
      releasesRoutes(app);
      analyticsRoutes(app, ctx);
      filesRoutes(app);
      downloadsRoutes(app);

      ctx.log.info('Sonarr Manager plugin routes registered');
    },
  };
}

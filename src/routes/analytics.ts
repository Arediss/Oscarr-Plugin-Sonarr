import type { FastifyInstance } from 'fastify';
import { applyQuotas, parseQuotas, serialiseQuotas } from '../quotas.js';

/** Only the slice of the plugin context these routes need. */
interface QuotaContext {
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
}
import type { SonarrPluginApi } from '../sonarr-api.js';

export function analyticsRoutes(app: FastifyInstance, ctx: QuotaContext) {
  app.get('/analytics', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;

    const [series, diskSpace, profiles] = await Promise.all([
      api.getAllSeries(),
      api.getDiskSpace(),
      api.getQualityProfiles(),
    ]);

    // Status distribution (derived — Sonarr's status field is broadcast-status, not availability).
    const statusCounts = { complete: 0, missing: 0, unmonitored: 0, continuing: 0, ended: 0 };
    let totalEpisodes = 0;
    let totalFiles = 0;
    let totalSize = 0;

    for (const s of series) {
      totalSize += s.statistics?.sizeOnDisk ?? 0;
      totalEpisodes += s.statistics?.episodeCount ?? 0;
      totalFiles += s.statistics?.episodeFileCount ?? 0;

      if (!s.monitored) statusCounts.unmonitored++;
      else {
        const ec = s.statistics?.episodeCount ?? 0;
        const fc = s.statistics?.episodeFileCount ?? 0;
        if (ec > 0 && fc >= ec) statusCounts.complete++;
        else statusCounts.missing++;
      }

      if (s.status === 'continuing') statusCounts.continuing++;
      else if (s.status === 'ended') statusCounts.ended++;
    }

    // Series-type distribution.
    const seriesTypeCounts: Record<string, number> = { standard: 0, anime: 0, daily: 0 };
    for (const s of series) {
      const t = s.seriesType || 'standard';
      seriesTypeCounts[t] = (seriesTypeCounts[t] || 0) + 1;
    }

    // Timeline — series added per month (last 12 months).
    const now = new Date();
    const timeline: Record<string, number> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      timeline[key] = 0;
    }
    for (const s of series) {
      if (!s.added) continue;
      const d = new Date(s.added);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in timeline) timeline[key]++;
    }

    // Root folder sizes.
    const rootFolders: Record<string, { count: number; size: number }> = {};
    for (const s of series) {
      const rf = s.rootFolderPath || 'Unknown';
      if (!rootFolders[rf]) rootFolders[rf] = { count: 0, size: 0 };
      rootFolders[rf].count++;
      rootFolders[rf].size += s.statistics?.sizeOnDisk ?? 0;
    }

    // Top series by size.
    const topBySize = series
      .map((s) => ({
        id: s.id,
        title: s.title,
        year: s.year,
        size: s.statistics?.sizeOnDisk ?? 0,
        episodeFileCount: s.statistics?.episodeFileCount ?? 0,
      }))
      .filter((s) => s.size > 0)
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);

    const profileMap: Record<number, string> = {};
    for (const p of profiles) profileMap[p.id] = p.name;

    return {
      overview: {
        totalSeries: series.length,
        totalEpisodes,
        totalFiles,
        totalSize,
        ...statusCounts,
      },
      seriesTypeCounts: Object.entries(seriesTypeCounts)
        .map(([name, count]) => ({ name, count }))
        .filter((x) => x.count > 0),
      diskSpace: applyQuotas(diskSpace, parseQuotas(await ctx.getSetting('rootFolderQuotas') as string | null)),
      timeline: Object.entries(timeline).map(([month, count]) => ({ month, count })),
      rootFolders: Object.entries(rootFolders)
        .map(([path, data]) => ({ path, ...data }))
        .sort((a, b) => b.size - a.size),
      topBySize,
      profileMap,
    };
  });

  app.post('/history/failed/:id', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    await api.retryFailedHistoryItem(parseInt(id));
    return { ok: true };
  });

  app.get('/analytics/history', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { page = '1', pageSize = '50', eventType } = request.query as Record<string, string>;
    return api.getHistory(parseInt(page), parseInt(pageSize), eventType);
  });

  /** Declared caps, keyed by root folder path. `/quotas` rather than `/settings`, which the core
   *  reserves for its own plugin-settings endpoint. */
  app.get('/quotas', async () => ({
    quotas: parseQuotas(await ctx.getSetting('rootFolderQuotas') as string | null),
  }));

  app.put('/quotas', async (request, reply) => {
    const body = (request.body ?? {}) as { quotas?: unknown };
    if (!body.quotas || typeof body.quotas !== 'object' || Array.isArray(body.quotas)) {
      return reply.status(400).send({ error: 'quotas must be an object keyed by root folder path' });
    }
    const stored = serialiseQuotas(body.quotas as Record<string, number>);
    await ctx.setSetting('rootFolderQuotas', stored);
    return { quotas: parseQuotas(stored) };
  });

}

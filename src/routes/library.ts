import type { FastifyInstance } from 'fastify';
import type { SonarrPluginApi, SonarrSeries } from '../sonarr-api.js';

// In-memory cache to avoid re-fetching the whole series list on every page request.
let seriesCache: { data: SonarrSeries[]; timestamp: number } | null = null;
const CACHE_TTL = 60_000;

async function getCachedSeries(api: SonarrPluginApi): Promise<SonarrSeries[]> {
  const now = Date.now();
  if (seriesCache && now - seriesCache.timestamp < CACHE_TTL) {
    return seriesCache.data;
  }
  const data = await api.getAllSeries();
  seriesCache = { data, timestamp: now };
  return data;
}

function mapSeries(s: SonarrSeries) {
  const stats = s.statistics;
  const episodeCount = stats?.episodeCount ?? 0;
  const fileCount = stats?.episodeFileCount ?? 0;
  const complete = episodeCount > 0 && fileCount >= episodeCount;
  return {
    id: s.id,
    title: s.title,
    year: s.year,
    tvdbId: s.tvdbId,
    monitored: s.monitored,
    status: s.status,
    seriesType: s.seriesType,
    network: s.network || null,
    qualityProfileId: s.qualityProfileId,
    rootFolderPath: s.rootFolderPath,
    added: s.added,
    sizeOnDisk: stats?.sizeOnDisk ?? 0,
    episodeFileCount: fileCount,
    episodeCount,
    totalEpisodeCount: stats?.totalEpisodeCount ?? 0,
    percentOfEpisodes: stats?.percentOfEpisodes ?? 0,
    hasFile: fileCount > 0,
    complete,
    poster: s.images?.find((i) => i.coverType === 'poster')?.remoteUrl || null,
  };
}

/** A series is only *missing* episodes that have actually aired. An upcoming show with nothing
 *  on disk is expected to be empty, and a continuing one is legitimately incomplete between
 *  seasons — painting either red buries the shows an admin can act on. */
function counts(s: SonarrSeries) {
  return { ec: s.statistics?.episodeCount ?? 0, fc: s.statistics?.episodeFileCount ?? 0 };
}

function isComplete(s: SonarrSeries): boolean {
  const { ec, fc } = counts(s);
  return ec > 0 && fc >= ec;
}

function isUpcoming(s: SonarrSeries): boolean {
  return s.monitored && s.status === 'upcoming' && counts(s).fc === 0;
}

function isActionableMissing(s: SonarrSeries): boolean {
  const { ec, fc } = counts(s);
  return s.monitored && ec > fc && !isUpcoming(s);
}

const SORTERS: Record<string, (a: SonarrSeries, b: SonarrSeries) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  year: (a, b) => (a.year || 0) - (b.year || 0),
  size: (a, b) => (a.statistics?.sizeOnDisk ?? 0) - (b.statistics?.sizeOnDisk ?? 0),
  added: (a, b) => new Date(a.added || 0).getTime() - new Date(b.added || 0).getTime(),
  episodes: (a, b) => (a.statistics?.episodeFileCount ?? 0) - (b.statistics?.episodeFileCount ?? 0),
};

export function libraryRoutes(app: FastifyInstance) {
  // Paginated, filtered series list (cache-backed).
  app.get('/series', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const {
      search, status, qualityProfileId, rootFolderPath, seriesType,
      sort = 'title', dir = 'asc',
      page = '1', pageSize = '50',
    } = request.query as Record<string, string>;

    const all = await getCachedSeries(api);
    let series = all;

    if (search) {
      const q = search.toLowerCase();
      series = series.filter((s) => s.title.toLowerCase().includes(q));
    }

    // status filter — applied on derived state (not raw Sonarr status)
    if (status === 'complete') {
      series = series.filter(isComplete);
    } else if (status === 'missing') {
      series = series.filter(isActionableMissing);
    } else if (status === 'upcoming') {
      series = series.filter(isUpcoming);
    } else if (status === 'unmonitored') {
      series = series.filter((s) => !s.monitored);
    } else if (status === 'continuing') {
      series = series.filter((s) => s.status === 'continuing');
    } else if (status === 'ended') {
      series = series.filter((s) => s.status === 'ended');
    }

    if (qualityProfileId) series = series.filter((s) => s.qualityProfileId === parseInt(qualityProfileId));
    if (rootFolderPath) series = series.filter((s) => s.rootFolderPath === rootFolderPath);
    if (seriesType) series = series.filter((s) => s.seriesType === seriesType);

    // Sort before slicing, or page 2 would be drawn from a differently-ordered list.
    const sorter = SORTERS[sort] ?? SORTERS.title;
    series = [...series].sort(dir === 'desc' ? (a, b) => sorter(b, a) : sorter);

    const total = series.length;
    const p = Math.max(1, parseInt(page));
    const ps = Math.min(100, Math.max(1, parseInt(pageSize)));
    const start = (p - 1) * ps;
    const slice = series.slice(start, start + ps);

    return {
      total,
      page: p,
      pageSize: ps,
      hasMore: start + ps < total,
      series: slice.map(mapSeries),
      // Library-wide totals, deliberately computed before filtering: the header states what the
      // library holds, not what the current filter happens to show.
      library: {
        count: all.length,
        sizeOnDisk: all.reduce((sum, s) => sum + (s.statistics?.sizeOnDisk ?? 0), 0),
        complete: all.filter(isComplete).length,
        missing: all.filter(isActionableMissing).length,
        upcoming: all.filter(isUpcoming).length,
        unmonitored: all.filter((s) => !s.monitored).length,
      },
    };
  });

  app.post('/series/invalidate-cache', async () => {
    seriesCache = null;
    return { ok: true };
  });

  // Single series detail (raw Sonarr series + derived stats).
  // The profile name is resolved here rather than in the modal: it is one call the backend
  // already has an authenticated client for, and it saves the frontend a second round trip
  // just to turn an id into a word.
  app.get('/series/:id', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const [series, profiles] = await Promise.all([
      api.getSeries(parseInt(id)),
      api.getQualityProfiles().catch(() => []),
    ]);
    const qualityProfileName = profiles.find((p) => p.id === series.qualityProfileId)?.name ?? null;
    return { series, qualityProfileName };
  });

  app.put('/series/:id/monitored', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const { monitored } = request.body as { monitored: boolean };
    await api.editSeries(parseInt(id), { monitored });
    seriesCache = null;
    return { ok: true };
  });

  app.put('/series/:id/tags', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const { tags } = request.body as { tags: number[] };
    await api.editSeries(parseInt(id), { tags });
    seriesCache = null;
    return { ok: true };
  });

  app.post('/series/:id/search', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const result = await api.searchSeries(parseInt(id));
    return { ok: true, commandId: result.id };
  });

  app.post('/series/:id/refresh', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    await api.refreshSeries(parseInt(id));
    return { ok: true };
  });

  app.post('/series/:id/rename', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    await api.renameSeries(parseInt(id));
    return { ok: true };
  });

  // Both flags default to false: removing a library entry should never take files with it
  // unless it was asked for.
  app.delete('/series/:id', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const { deleteFiles, addImportExclusion } = request.query as Record<string, string>;
    await api.deleteSeries(parseInt(id), {
      deleteFiles: deleteFiles === 'true',
      addImportExclusion: addImportExclusion === 'true',
    });
    seriesCache = null; // the list would otherwise keep serving the series for up to 60s
    return { ok: true };
  });

  app.get('/series/:id/history', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const items = await api.getSeriesHistory(parseInt(id));
    return { items };
  });

  app.get('/series/:id/queue', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const items = await api.getQueueForSeries(parseInt(id));
    return { items };
  });

  app.get('/series/:id/blocklist', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    const items = await api.getBlocklistForSeries(parseInt(id));
    return { items };
  });

  app.get('/tags', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    return api.getTags();
  });

  app.get('/profiles', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    return api.getQualityProfiles();
  });

  app.get('/rootfolders', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    return api.getRootFolders();
  });

  app.get('/command/:id', async (request) => {
    const api: SonarrPluginApi = (request as any).sonarrApi;
    const { id } = request.params as { id: string };
    return api.getCommandStatus(parseInt(id));
  });
}

import axios, { type AxiosInstance } from 'axios';

// ── Types (Sonarr V3 shapes — what we actually consume) ────────────

export interface SonarrSeriesSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}

export interface SonarrSeries {
  id: number;
  title: string;
  sortTitle?: string;
  year: number;
  tvdbId: number;
  tmdbId?: number;
  imdbId?: string;
  overview?: string;
  monitored: boolean;
  status: string;
  seriesType: 'standard' | 'anime' | 'daily';
  network?: string;
  qualityProfileId: number;
  rootFolderPath: string;
  path: string;
  added: string;
  runtime?: number;
  genres?: string[];
  tags: number[];
  seasons: SonarrSeriesSeason[];
  images: { coverType: string; remoteUrl?: string; url?: string }[];
  statistics?: {
    seasonCount: number;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
    releaseGroups?: string[];
  };
}

export interface SonarrEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  title: string;
  overview?: string;
  airDate?: string | null;
  airDateUtc?: string | null;
  hasFile: boolean;
  monitored: boolean;
  episodeFileId?: number;
  episodeFile?: {
    id: number;
    quality: { quality: { id: number; name: string; resolution?: number } };
    size: number;
    languages?: { id: number; name: string }[];
  } | null;
}

export interface SonarrEpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  languages?: { id: number; name: string }[];
  quality: { quality: { id: number; name: string; resolution?: number } };
  mediaInfo?: {
    audioBitrate?: number;
    audioChannels?: number;
    audioCodec?: string;
    audioLanguages?: string;
    audioStreamCount?: number;
    videoBitDepth?: number;
    videoBitrate?: number;
    videoCodec?: string;
    videoDynamicRangeType?: string;
    videoFps?: number;
    resolution?: string;
    runTime?: string;
    scanType?: string;
    subtitles?: string;
  };
  customFormats?: { id: number; name: string }[];
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
  cutoff: number;
  items: { quality?: { id: number; name: string }; allowed: boolean }[];
}

export interface SonarrRelease {
  guid: string;
  quality: { quality: { id: number; name: string; resolution?: number } };
  age: number;
  ageHours: number;
  ageMinutes: number;
  size: number;
  indexer: string;
  indexerId?: number;
  releaseGroup?: string;
  title: string;
  approved: boolean;
  rejections: string[];
  seeders?: number;
  leechers?: number;
  protocol: string;
  downloadUrl?: string;
  infoUrl?: string;
  customFormatScore?: number;
  seasonNumber?: number;
  fullSeason?: boolean;
}

export interface SonarrBlocklistItem {
  id: number;
  seriesId: number;
  episodeIds?: number[];
  sourceTitle: string;
  date: string;
  quality: { quality: { id: number; name: string } };
  message?: string;
  series?: { title: string; year?: number };
}

export interface SonarrDiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface SonarrHistoryItem {
  id: number;
  seriesId: number;
  episodeId: number;
  sourceTitle: string;
  quality: { quality: { id: number; name: string } };
  date: string;
  eventType: string;
  data?: Record<string, string>;
  series?: { title: string; year?: number };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

export interface SonarrQueueItem {
  id: number;
  seriesId: number;
  episodeId: number;
  seasonNumber?: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: { title: string; messages: string[] }[];
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  protocol: string;
  downloadClient?: string;
  quality: { quality: { id: number; name: string } };
  series?: { title: string; year?: number };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

export interface SonarrRootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace?: number;
  totalSpace?: number;
}

export interface SonarrTag {
  id: number;
  label: string;
}

export interface PaginatedResult<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

// ── Client ─────────────────────────────────────────────────────────

export class SonarrPluginApi {
  private api: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    this.api = axios.create({
      baseURL: `${cleanUrl}/api/v3`,
      headers: { 'X-Api-Key': apiKey },
      timeout: 30000,
    });
  }

  // ── Library ──────────────────────────────────────────────────────

  async getAllSeries(): Promise<SonarrSeries[]> {
    const { data } = await this.api.get('/series', { params: { includeSeasonImages: false } });
    return data;
  }

  async getSeries(id: number): Promise<SonarrSeries> {
    const { data } = await this.api.get(`/series/${id}`);
    return data;
  }

  async editSeries(id: number, updates: Partial<SonarrSeries>): Promise<SonarrSeries> {
    const current = await this.getSeries(id);
    const { data } = await this.api.put(`/series/${id}`, { ...current, ...updates });
    return data;
  }

  /** Removes the series from Sonarr's library. `deleteFiles` also unlinks what is on disk;
   *  `addImportExclusion` stops a list from silently re-adding it on the next sync — the usual
   *  reason a removed title reappears a day later. */
  async deleteSeries(
    id: number,
    opts: { deleteFiles?: boolean; addImportExclusion?: boolean } = {},
  ): Promise<void> {
    await this.api.delete(`/series/${id}`, {
      params: {
        deleteFiles: opts.deleteFiles === true,
        addImportExclusion: opts.addImportExclusion === true,
      },
    });
  }

  // ── Seasons / Episodes ───────────────────────────────────────────

  async getEpisodes(seriesId: number, seasonNumber?: number): Promise<SonarrEpisode[]> {
    const params: Record<string, unknown> = { seriesId };
    if (seasonNumber !== undefined) params.seasonNumber = seasonNumber;
    const { data } = await this.api.get('/episode', { params });
    return data;
  }

  async getEpisode(id: number): Promise<SonarrEpisode> {
    const { data } = await this.api.get(`/episode/${id}`);
    return data;
  }

  async monitorEpisodes(episodeIds: number[], monitored: boolean): Promise<void> {
    await this.api.put('/episode/monitor', { episodeIds, monitored });
  }

  async setSeasonMonitored(seriesId: number, seasonNumber: number, monitored: boolean): Promise<SonarrSeries> {
    const current = await this.getSeries(seriesId);
    const seasons = current.seasons.map((s) =>
      s.seasonNumber === seasonNumber ? { ...s, monitored } : s,
    );
    const { data } = await this.api.put(`/series/${seriesId}`, { ...current, seasons });
    return data;
  }

  // ── Episode files ────────────────────────────────────────────────

  async getEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
    const { data } = await this.api.get('/episodefile', { params: { seriesId } });
    return data;
  }

  async deleteEpisodeFile(fileId: number): Promise<void> {
    await this.api.delete(`/episodefile/${fileId}`);
  }

  // ── Quality ──────────────────────────────────────────────────────

  async getCutoffUnmet(page = 1, pageSize = 20): Promise<PaginatedResult<SonarrEpisode>> {
    const { data } = await this.api.get('/wanted/cutoff', {
      params: { page, pageSize, sortKey: 'airDateUtc', sortDirection: 'descending', includeSeries: true },
    });
    return { page: data.page, pageSize: data.pageSize, totalRecords: data.totalRecords, records: data.records };
  }

  async getQualityProfiles(): Promise<SonarrQualityProfile[]> {
    const { data } = await this.api.get('/qualityprofile');
    return data;
  }

  // ── Releases ─────────────────────────────────────────────────────

  async getReleasesForEpisode(episodeId: number): Promise<SonarrRelease[]> {
    const { data } = await this.api.get('/release', { params: { episodeId } });
    return data;
  }

  async getReleasesForSeason(seriesId: number, seasonNumber: number): Promise<SonarrRelease[]> {
    const { data } = await this.api.get('/release', { params: { seriesId, seasonNumber } });
    return data;
  }

  async grabRelease(guid: string, indexerId: number): Promise<void> {
    await this.api.post('/release', { guid, indexerId });
  }

  async getBlocklist(page = 1, pageSize = 20): Promise<PaginatedResult<SonarrBlocklistItem>> {
    const { data } = await this.api.get('/blocklist', {
      params: { page, pageSize, sortKey: 'date', sortDirection: 'descending' },
    });
    return { page: data.page, pageSize: data.pageSize, totalRecords: data.totalRecords, records: data.records };
  }

  // Sonarr's /blocklist doesn't filter by seriesId directly — fetch a wide page and filter.
  async getBlocklistForSeries(seriesId: number): Promise<SonarrBlocklistItem[]> {
    const { data } = await this.api.get('/blocklist', {
      params: { page: 1, pageSize: 500, sortKey: 'date', sortDirection: 'descending' },
    });
    const records: SonarrBlocklistItem[] = Array.isArray(data?.records) ? data.records : [];
    return records.filter((r) => r.seriesId === seriesId);
  }

  async deleteBlocklistItem(id: number): Promise<void> {
    await this.api.delete(`/blocklist/${id}`);
  }

  // ── Analytics / History ──────────────────────────────────────────

  async getDiskSpace(): Promise<SonarrDiskSpace[]> {
    const { data } = await this.api.get('/diskspace');
    return data;
  }

  async getHistory(page = 1, pageSize = 20, eventType?: string): Promise<PaginatedResult<SonarrHistoryItem>> {
    const params: Record<string, unknown> = {
      page, pageSize,
      sortKey: 'date', sortDirection: 'descending',
      includeSeries: true, includeEpisode: true,
    };
    if (eventType) params.eventType = eventType;
    const { data } = await this.api.get('/history', { params });
    return { page: data.page, pageSize: data.pageSize, totalRecords: data.totalRecords, records: data.records };
  }

  async getSeriesHistory(seriesId: number): Promise<SonarrHistoryItem[]> {
    const { data } = await this.api.get('/history/series', {
      params: { seriesId, includeEpisode: true },
    });
    return Array.isArray(data) ? data : (data?.records ?? []);
  }

  async retryFailedHistoryItem(historyId: number): Promise<void> {
    await this.api.post(`/history/failed/${historyId}`);
  }

  // ── Commands ─────────────────────────────────────────────────────

  async searchSeries(seriesId: number): Promise<{ id: number }> {
    const { data } = await this.api.post('/command', { name: 'SeriesSearch', seriesId });
    return { id: data.id };
  }

  async searchSeason(seriesId: number, seasonNumber: number): Promise<{ id: number }> {
    const { data } = await this.api.post('/command', { name: 'SeasonSearch', seriesId, seasonNumber });
    return { id: data.id };
  }

  async searchEpisode(episodeIds: number[]): Promise<{ id: number }> {
    const { data } = await this.api.post('/command', { name: 'EpisodeSearch', episodeIds });
    return { id: data.id };
  }

  async refreshSeries(seriesId: number): Promise<void> {
    await this.api.post('/command', { name: 'RefreshSeries', seriesId });
  }

  async renameSeries(seriesId: number): Promise<void> {
    await this.api.post('/command', { name: 'RenameSeries', seriesIds: [seriesId] });
  }

  /** `message` and `result` are Sonarr's own words for how the command ended — worth relaying
   *  rather than telling the user to go and look for themselves. */
  async getCommandStatus(commandId: number): Promise<{
    status: string; result?: string; message?: string; started?: string; ended?: string;
  }> {
    const { data } = await this.api.get(`/command/${commandId}`);
    return {
      status: data.status,
      result: data.result,
      message: data.message,
      started: data.started,
      ended: data.ended,
    };
  }

  // ── Queue ────────────────────────────────────────────────────────

  async getQueue(page = 1, pageSize = 20): Promise<PaginatedResult<SonarrQueueItem>> {
    const { data } = await this.api.get('/queue', {
      params: {
        page, pageSize,
        sortKey: 'progress', sortDirection: 'ascending',
        includeSeries: true, includeEpisode: true,
        includeUnknownSeriesItems: false,
      },
    });
    return { page: data.page, pageSize: data.pageSize, totalRecords: data.totalRecords, records: data.records };
  }

  // Sonarr's /queue doesn't filter by seriesId server-side — fetch wide and filter.
  async getQueueForSeries(seriesId: number): Promise<SonarrQueueItem[]> {
    const { data } = await this.api.get('/queue', {
      params: {
        page: 1, pageSize: 200,
        sortKey: 'progress', sortDirection: 'ascending',
        includeSeries: false, includeEpisode: true,
        includeUnknownSeriesItems: false,
      },
    });
    const records: SonarrQueueItem[] = Array.isArray(data?.records) ? data.records : [];
    return records.filter((r) => r.seriesId === seriesId);
  }

  async removeQueueItem(
    id: number,
    options?: { removeFromClient?: boolean; blocklist?: boolean },
  ): Promise<void> {
    await this.api.delete(`/queue/${id}`, {
      params: {
        removeFromClient: options?.removeFromClient ?? false,
        blocklist: options?.blocklist ?? false,
      },
    });
  }

  // ── Tags / Root folders ──────────────────────────────────────────

  async getTags(): Promise<SonarrTag[]> {
    const { data } = await this.api.get('/tag');
    return data;
  }

  async getRootFolders(): Promise<SonarrRootFolder[]> {
    const { data } = await this.api.get('/rootfolder');
    return data;
  }
}

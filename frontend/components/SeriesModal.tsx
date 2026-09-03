import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SeasonEpisodesView } from './SeasonEpisodesView';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface SeriesDetail {
  id: number;
  title: string;
  year: number;
  overview?: string;
  monitored: boolean;
  status: string;
  seriesType: 'standard' | 'anime' | 'daily';
  network?: string;
  path: string;
  qualityProfileId: number;
  runtime?: number;
  genres?: string[];
  imdbId?: string;
  tmdbId?: number;
  tvdbId: number;
  images: { coverType: string; remoteUrl?: string; url?: string }[];
  seasons: { seasonNumber: number; monitored: boolean; statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount: number; sizeOnDisk: number; percentOfEpisodes: number } }[];
  statistics?: {
    seasonCount: number;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
  // Sonarr sends all of these on /series/{id}; optional here so a field the instance does not
  // populate simply does not render, rather than printing "undefined".
  rootFolderPath?: string;
  added?: string;
  certification?: string;
  originalLanguage?: { id: number; name: string };
  airTime?: string;
  firstAired?: string;
  nextAiring?: string;
  previousAiring?: string;
  ended?: boolean;
  ratings?: { value?: number; votes?: number };
}

interface SeasonSummary {
  seasonNumber: number;
  monitored: boolean;
  episodeCount: number;
  totalEpisodeCount: number;
  episodeFileCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

interface EpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  quality: { quality: { id: number; name: string; resolution?: number } };
  mediaInfo?: {
    audioCodec?: string;
    audioChannels?: number;
    audioLanguages?: string;
    videoCodec?: string;
    videoDynamicRangeType?: string;
    resolution?: string;
    runTime?: string;
    subtitles?: string;
  };
}

interface HistoryItem {
  id: number;
  seriesId: number;
  episodeId: number;
  sourceTitle: string;
  quality: { quality: { id: number; name: string } };
  date: string;
  eventType: string;
  data?: Record<string, string>;
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

interface QueueItem {
  id: number;
  seriesId: number;
  episodeId: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: { title: string; messages: string[] }[];
  size: number;
  sizeleft: number;
  timeleft?: string;
  protocol: string;
  downloadClient?: string;
  quality: { quality: { id: number; name: string } };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

interface BlocklistItem {
  id: number;
  seriesId: number;
  sourceTitle: string;
  date: string;
  quality: { quality: { id: number; name: string } };
  message?: string;
}

interface SeriesModalProps {
  seriesId: number;
  onClose: () => void;
  /** Fired after the series is removed from Sonarr, so the library can drop it from the list
   *  instead of showing a title that no longer exists. */
  onRemoved?: () => void;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRuntime(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  return `${minutes}m / ep`;
}

function epTag(ep?: { seasonNumber: number; episodeNumber: number }): string {
  if (!ep) return '';
  return `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
}

type ActionState = 'idle' | 'loading' | 'success' | 'error';
type SearchPhase = 'idle' | 'searching' | 'polling' | 'done' | 'error';

/** What the last automatic search actually achieved, so the queue can say so instead of
 *  showing a bare "nothing here" to someone who just asked Sonarr to find something. */
type SearchOutcome =
  | { kind: 'grabbed'; titles: string[] }
  | { kind: 'nothing'; reason?: string };
type TabId = 'overview' | 'seasons' | 'files' | 'history' | 'queue' | 'blocklist';

interface InlineMessage {
  text: string;
  type: 'success' | 'error';
}

const EVENT_META: Record<string, { label: string; color: string; bg: string }> = {
  grabbed: { label: 'Grabbed', color: 'text-sky-300', bg: 'bg-sky-500/15' },
  downloadFolderImported: { label: 'Imported', color: 'text-ndp-success', bg: 'bg-ndp-success/15' },
  downloadFailed: { label: 'Failed', color: 'text-ndp-error', bg: 'bg-ndp-error/15' },
  episodeFileDeleted: { label: 'Deleted', color: 'text-ndp-text-dim', bg: 'bg-white/5' },
  episodeFileRenamed: { label: 'Renamed', color: 'text-ndp-text-dim', bg: 'bg-white/5' },
  downloadIgnored: { label: 'Ignored', color: 'text-amber-300', bg: 'bg-amber-500/15' },
  seriesFolderImported: { label: 'Imported', color: 'text-ndp-success', bg: 'bg-ndp-success/15' },
};

function eventMeta(eventType: string) {
  return EVENT_META[eventType] ?? { label: eventType, color: 'text-ndp-text-dim', bg: 'bg-white/5' };
}

// ──────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────

export function SeriesModal({ seriesId, onClose, onRemoved }: SeriesModalProps) {
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPanelVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle');
  const [searchOutcome, setSearchOutcome] = useState<SearchOutcome | null>(null);
  const [refreshState, setRefreshState] = useState<ActionState>('idle');
  const [monitorState, setMonitorState] = useState<ActionState>('idle');
  const [deleteState, setDeleteState] = useState<ActionState>('idle');
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeFiles, setRemoveFiles] = useState(false);
  const [removeExclusion, setRemoveExclusion] = useState(false);
  const [message, setMessage] = useState<InlineMessage | null>(null);

  // Seasons drill-down state
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [drilledSeason, setDrilledSeason] = useState<number | null>(null);
  const [seasonActionBusy, setSeasonActionBusy] = useState<number | null>(null);

  // Files
  const [files, setFiles] = useState<EpisodeFile[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);

  // History
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);

  // Queue
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [removingQueue, setRemovingQueue] = useState<number | null>(null);

  // Blocklist
  const [blocklist, setBlocklist] = useState<BlocklistItem[] | null>(null);
  const [blocklistLoading, setBlocklistLoading] = useState(false);
  const [unblocking, setUnblocking] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // Load series detail + seasons summary.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/plugins/sonarr/series/${seriesId}`, { credentials: 'include' }).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        return r.json();
      }),
      fetch(`/api/plugins/sonarr/series/${seriesId}/seasons`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { seasons: [] })),
    ])
      .then(([detail, seasonsData]) => {
        if (cancelled) return;
        setSeries(detail?.series || null);
        setProfileName(detail?.qualityProfileName ?? null);
        setSeasons(Array.isArray(seasonsData?.seasons) ? seasonsData.seasons : []);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load series'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [seriesId]);

  // Queue fetched up-front for badge counts.
  useEffect(() => {
    let cancelled = false;
    setQueueLoading(true);
    fetch(`/api/plugins/sonarr/series/${seriesId}/queue`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => { if (!cancelled) setQueue(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => { if (!cancelled) setQueue([]); })
      .finally(() => { if (!cancelled) setQueueLoading(false); });
    return () => { cancelled = true; };
  }, [seriesId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  // Lazy-load per-tab.
  const loadFiles = useCallback(async () => {
    if (files !== null) return;
    setFilesLoading(true);
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/files`, { credentials: 'include' });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch {
      setFiles([]);
      showMessage('Failed to load files', 'error');
    }
    setFilesLoading(false);
  }, [files, seriesId]);

  const loadHistory = useCallback(async () => {
    if (history !== null) return;
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/history`, { credentials: 'include' });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setHistory(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setHistory([]);
      showMessage('Failed to load history', 'error');
    }
    setHistoryLoading(false);
  }, [history, seriesId]);

  const loadBlocklist = useCallback(async () => {
    if (blocklist !== null) return;
    setBlocklistLoading(true);
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/blocklist`, { credentials: 'include' });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setBlocklist(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setBlocklist([]);
      showMessage('Failed to load blocklist', 'error');
    }
    setBlocklistLoading(false);
  }, [blocklist, seriesId]);

  useEffect(() => {
    if (activeTab === 'files') loadFiles();
    if (activeTab === 'history') loadHistory();
    if (activeTab === 'blocklist') loadBlocklist();
  }, [activeTab, loadFiles, loadHistory, loadBlocklist]);

  // Whole-series actions.

  /** Sonarr hands each release to the download client, which then registers it in the queue — the
   *  two are not simultaneous. Give it a few seconds before concluding nothing was grabbed. */
  const settledQueue = useCallback(async (before: Set<number>): Promise<QueueItem[]> => {
    let latest: QueueItem[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/queue`, { credentials: 'include' });
        const data = r.ok ? await r.json() : null;
        latest = Array.isArray(data?.items) ? data.items : [];
      } catch {
        latest = [];
      }
      if (latest.some((item) => !before.has(item.id))) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setQueue(latest);
    return latest;
  }, [seriesId]);

  const reportSearchResult = useCallback(async (before: Set<number>, sonarrMessage?: string) => {
    const after = await settledQueue(before);
    const fresh = after.filter((item) => !before.has(item.id));

    if (fresh.length > 0) {
      setSearchOutcome({ kind: 'grabbed', titles: fresh.map((item) => item.title) });
      showMessage(
        fresh.length === 1
          ? 'Grabbed 1 episode — downloading now'
          : `Grabbed ${fresh.length} episodes — downloading now`,
        'success',
      );
      return;
    }

    // Sonarr completed without grabbing: every candidate failed its quality or custom-format
    // checks, or the episodes on disk already meet the cutoff. Its own message says which.
    setSearchOutcome({ kind: 'nothing', reason: sonarrMessage });
    showMessage(sonarrMessage || 'Sonarr found nothing worth grabbing', 'error');
  }, [settledQueue]);

  const handleSearch = async () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const before = new Set((queue ?? []).map((item) => item.id));
    setActiveTab('queue');
    setSearchOutcome(null);
    setSearchPhase('searching');
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/search`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error();
      const data = await r.json();
      const commandId = data.commandId;
      if (!commandId) {
        setSearchPhase('done');
        await reportSearchResult(before);
        return;
      }
      setSearchPhase('polling');
      pollRef.current = setInterval(async () => {
        try {
          const statusR = await fetch(`/api/plugins/sonarr/command/${commandId}`, { credentials: 'include' });
          if (!statusR.ok) throw new Error();
          const statusData = await statusR.json();
          if (statusData.status === 'completed') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setSearchPhase('done');
            await reportSearchResult(before, statusData.message);
          } else if (statusData.status === 'failed') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setSearchPhase('error');
            setSearchOutcome({ kind: 'nothing', reason: statusData.message });
            showMessage(statusData.message || 'Sonarr could not complete the search', 'error');
          }
        } catch {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setSearchPhase('error');
          showMessage('Failed to poll search status', 'error');
        }
      }, 2000);
    } catch {
      setSearchPhase('error');
      showMessage('Search failed', 'error');
    }
  };

  const handleRefresh = async () => {
    setRefreshState('loading');
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/refresh`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error();
      setRefreshState('success');
      showMessage('Refresh command sent', 'success');
    } catch {
      setRefreshState('error');
      showMessage('Refresh failed', 'error');
    }
    setTimeout(() => setRefreshState('idle'), 2000);
  };

  const handleToggleMonitored = async () => {
    if (!series) return;
    setMonitorState('loading');
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/monitored`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitored: !series.monitored }),
      });
      if (!r.ok) throw new Error();
      setSeries({ ...series, monitored: !series.monitored });
      setMonitorState('success');
      showMessage(`Series ${series.monitored ? 'unmonitored' : 'monitored'}`, 'success');
    } catch {
      setMonitorState('error');
      showMessage('Toggle monitored failed', 'error');
    }
    setTimeout(() => setMonitorState('idle'), 2000);
  };

  /** Removing the library entry is not the same act as deleting its files, and conflating the
   *  two is how people lose media they meant to keep. Both flags are opt-in and stated plainly. */
  const handleRemoveSeries = async () => {
    setDeleteState('loading');
    try {
      const params = new URLSearchParams({
        deleteFiles: String(removeFiles),
        addImportExclusion: String(removeExclusion),
      });
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}?${params}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error();
      setDeleteState('success');
      setRemoveOpen(false);
      onRemoved?.();
      onClose();
    } catch {
      setDeleteState('error');
      showMessage('Could not remove this series from Sonarr', 'error');
      setTimeout(() => setDeleteState('idle'), 2000);
    }
  };

  // Season actions (outside drill-down)
  const handleSeasonSearch = async (seasonNumber: number) => {
    setSeasonActionBusy(seasonNumber);
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/seasons/${seasonNumber}/search`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) throw new Error();
      showMessage(`Season ${seasonNumber} search sent`, 'success');
    } catch {
      showMessage('Season search failed', 'error');
    }
    setSeasonActionBusy(null);
  };

  const handleSeasonMonitor = async (seasonNumber: number, monitored: boolean) => {
    setSeasonActionBusy(seasonNumber);
    try {
      const r = await fetch(`/api/plugins/sonarr/series/${seriesId}/seasons/${seasonNumber}/monitored`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitored }),
      });
      if (!r.ok) throw new Error();
      setSeasons((prev) => prev.map((s) => (s.seasonNumber === seasonNumber ? { ...s, monitored } : s)));
      showMessage(`Season ${seasonNumber} ${monitored ? 'monitored' : 'unmonitored'}`, 'success');
    } catch {
      showMessage('Season monitor toggle failed', 'error');
    }
    setSeasonActionBusy(null);
  };

  // File actions
  const handleDeleteFile = async (fileId: number) => {
    setDeletingFileId(fileId);
    try {
      const r = await fetch(`/api/plugins/sonarr/episodefile/${fileId}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      setFiles((prev) => (prev ?? []).filter((f) => f.id !== fileId));
      showMessage('Episode file deleted', 'success');
    } catch {
      showMessage('Delete failed', 'error');
    }
    setDeletingFileId(null);
  };

  // History
  const handleRetryFailed = async (historyId: number) => {
    setRetrying(historyId);
    try {
      const r = await fetch(`/api/plugins/sonarr/history/failed/${historyId}`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error();
      showMessage('Retry triggered — a new search will run', 'success');
    } catch {
      showMessage('Retry failed', 'error');
    }
    setRetrying(null);
  };

  // Queue
  const handleRemoveQueue = async (itemId: number, blocklistFlag: boolean) => {
    setRemovingQueue(itemId);
    try {
      const params = new URLSearchParams({ removeFromClient: 'true', blocklist: String(blocklistFlag) });
      const r = await fetch(`/api/plugins/sonarr/queue/${itemId}?${params}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      setQueue((prev) => (prev ?? []).filter((q) => q.id !== itemId));
      showMessage(blocklistFlag ? 'Removed & blocklisted' : 'Removed from queue', 'success');
    } catch {
      showMessage('Failed to remove queue item', 'error');
    }
    setRemovingQueue(null);
  };

  // Blocklist
  const handleUnblock = async (blocklistId: number) => {
    setUnblocking(blocklistId);
    try {
      const r = await fetch(`/api/plugins/sonarr/blocklist/${blocklistId}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      setBlocklist((prev) => (prev ?? []).filter((b) => b.id !== blocklistId));
      showMessage('Removed from blocklist', 'success');
    } catch {
      showMessage('Failed to remove from blocklist', 'error');
    }
    setUnblocking(null);
  };

  const isSearchBusy = searchPhase === 'searching' || searchPhase === 'polling';
  const poster = series?.images?.find((i) => i.coverType === 'poster');
  const posterUrl = poster?.remoteUrl || poster?.url || null;

  const queueCount = queue?.length ?? 0;
  const blocklistCount = blocklist?.length ?? 0;
  const filesCount = files?.length ?? 0;

  const TABS: { id: TabId; label: string; badge?: number; badgeTone?: 'accent' | 'dim' }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'seasons', label: 'Seasons', badge: seasons.length || undefined, badgeTone: 'dim' },
    { id: 'files', label: 'Files', badge: filesCount || undefined, badgeTone: 'dim' },
    { id: 'history', label: 'History' },
    { id: 'queue', label: 'Queue', badge: queueCount || undefined, badgeTone: 'accent' },
    { id: 'blocklist', label: 'Blocklist', badge: blocklistCount || undefined, badgeTone: 'dim' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={
          'w-full max-w-5xl bg-ndp-surface border-l border-white/5 ' +
          'flex flex-col shadow-2xl shadow-black/60 transition-transform duration-300 ease-out ' +
          (panelVisible ? 'translate-x-0' : 'translate-x-full')
        }
        style={{ position: 'fixed', top: 0, right: 0, height: '100dvh' }}
      >
        <button
          onClick={onClose}
          className="flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-ndp-text-dim hover:text-ndp-text transition-colors"
          style={{ position: 'absolute', top: 16, right: 16, width: 32, height: 32, zIndex: 10 }}
          aria-label="Close"
        >
          <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="p-6 text-center">
            <p className="text-ndp-error">{error}</p>
          </div>
        )}

        {series && !loading && (
          <>
            {/* Header */}
            <div className="flex gap-5 p-6 pr-14 border-b border-white/5 flex-shrink-0">
              {posterUrl ? (
                <img src={posterUrl} alt={series.title} className="object-cover rounded-xl flex-shrink-0" style={{ width: 128, height: 192 }} />
              ) : (
                <div className="bg-white/5 rounded-xl flex items-center justify-center text-ndp-text-dim flex-shrink-0 text-xs" style={{ width: 128, height: 192 }}>
                  No Poster
                </div>
              )}
              <div className="min-w-0 flex-1 flex flex-col">
                <h2 className="text-xl sm:text-2xl font-bold text-ndp-text leading-tight">
                  {series.title}
                  {series.year ? <span className="text-ndp-text-dim font-normal ml-2">({series.year})</span> : null}
                </h2>

                <div className="flex items-center flex-wrap gap-2 mt-2 text-xs">
                  <span
                    className={
                      'inline-block px-2.5 py-0.5 rounded-full font-medium ' +
                      (!series.monitored
                        ? 'bg-white/10 text-ndp-text-dim'
                        : (series.statistics && series.statistics.episodeCount > 0 && series.statistics.episodeFileCount >= series.statistics.episodeCount)
                          ? 'bg-ndp-success/15 text-ndp-success'
                          : 'bg-ndp-error/15 text-ndp-error')
                    }
                  >
                    {!series.monitored
                      ? 'Unmonitored'
                      : (series.statistics && series.statistics.episodeCount > 0 && series.statistics.episodeFileCount >= series.statistics.episodeCount)
                        ? 'Complete'
                        : 'Missing episodes'}
                  </span>
                  <span className="inline-block px-2.5 py-0.5 rounded-full font-medium bg-white/5 text-ndp-text-dim capitalize">
                    {series.status}
                  </span>
                  <span className="inline-block px-2.5 py-0.5 rounded-full font-medium bg-white/5 text-ndp-text-dim capitalize">
                    {series.seriesType}
                  </span>
                  {queueCount > 0 && (
                    <span className="inline-block px-2.5 py-0.5 rounded-full font-medium bg-sky-500/20 text-sky-300">
                      Downloading
                    </span>
                  )}
                  {series.statistics && (
                    <span className="text-ndp-text-dim">
                      {series.statistics.episodeFileCount}/{series.statistics.episodeCount} eps
                    </span>
                  )}
                  {series.statistics && series.statistics.sizeOnDisk > 0 && (
                    <span className="text-ndp-text-dim">· {formatSize(series.statistics.sizeOnDisk)}</span>
                  )}
                  {formatRuntime(series.runtime) && (
                    <span className="text-ndp-text-dim">· {formatRuntime(series.runtime)}</span>
                  )}
                  {series.network && (
                    <span className="text-ndp-text-dim">· {series.network}</span>
                  )}
                  {series.genres && series.genres.length > 0 && (
                    <span className="text-ndp-text-dim truncate">· {series.genres.slice(0, 3).join(', ')}</span>
                  )}
                </div>

                {series.overview && (
                  <p className="text-sm text-ndp-text-dim leading-relaxed mt-3 line-clamp-3">{series.overview}</p>
                )}

                <div className="flex items-center gap-3 mt-3 text-xs">
                  {series.tvdbId && (
                    <a href={`https://www.thetvdb.com/?tab=series&id=${series.tvdbId}`} target="_blank" rel="noopener noreferrer" className="text-ndp-accent hover:underline">
                      TVDB
                    </a>
                  )}
                  {series.imdbId && (
                    <a href={`https://www.imdb.com/title/${series.imdbId}`} target="_blank" rel="noopener noreferrer" className="text-ndp-accent hover:underline">
                      IMDb
                    </a>
                  )}
                  {series.tmdbId && (
                    <a href={`https://www.themoviedb.org/tv/${series.tmdbId}`} target="_blank" rel="noopener noreferrer" className="text-ndp-accent hover:underline">
                      TMDB
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Tabs + actions */}
            <div className="flex items-center justify-between gap-3 border-b border-white/5 flex-shrink-0 pl-4 pr-3">
              <div className="flex gap-1 overflow-x-auto flex-1 min-w-0 pt-3" style={{ scrollbarWidth: 'none' }}>
                {TABS.map(({ id, label, badge, badgeTone }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => { setActiveTab(id); if (id !== 'seasons') setDrilledSeason(null); }}
                      className={
                        'px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ' +
                        (active ? 'border-ndp-accent text-ndp-accent' : 'border-transparent text-ndp-text-dim hover:text-ndp-text')
                      }
                    >
                      {label}
                      {badge !== undefined && (
                        <span
                          className={
                            'text-[10px] px-1.5 py-0.5 rounded-full font-semibold ' +
                            (badgeTone === 'accent' ? 'bg-sky-500/25 text-sky-300' : 'bg-white/10 text-ndp-text-dim')
                          }
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 py-2">
                <button
                  onClick={handleSearch}
                  disabled={isSearchBusy}
                  className="text-xs font-medium rounded-lg bg-ndp-accent text-white hover:bg-ndp-accent/90 transition-colors disabled:opacity-50 px-3 py-1.5 whitespace-nowrap"
                >
                  {isSearchBusy ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                      Searching
                    </span>
                  ) : 'Search'}
                </button>

                <button
                  onClick={handleRefresh}
                  disabled={refreshState === 'loading'}
                  className="text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-ndp-text transition-colors disabled:opacity-50 px-3 py-1.5 whitespace-nowrap"
                >
                  {refreshState === 'loading' ? 'Refreshing…' : 'Refresh'}
                </button>

                <button
                  onClick={handleToggleMonitored}
                  disabled={monitorState === 'loading'}
                  className={
                    'text-xs font-medium rounded-lg transition-colors disabled:opacity-50 px-3 py-1.5 whitespace-nowrap ' +
                    (series.monitored
                      ? 'bg-white/10 hover:bg-white/15 text-ndp-text'
                      : 'bg-ndp-accent/20 hover:bg-ndp-accent/30 text-ndp-accent')
                  }
                >
                  {monitorState === 'loading' ? '…' : (series.monitored ? 'Unmonitor' : 'Monitor')}
                </button>

                <button
                  onClick={() => setRemoveOpen(true)}
                  className="text-xs font-medium rounded-lg bg-ndp-error/10 hover:bg-ndp-error/20 text-ndp-error transition-colors px-3 py-1.5 whitespace-nowrap"
                  title="Remove this series from Sonarr's library"
                >
                  Remove
                </button>
              </div>
            </div>

            {message && (
              <div
                className={
                  'mx-6 mt-3 rounded-lg text-sm font-medium px-4 py-2 flex-shrink-0 ' +
                  (message.type === 'success' ? 'bg-ndp-success/15 text-ndp-success' : 'bg-ndp-error/15 text-ndp-error')
                }
              >
                {message.text}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'overview' && <OverviewTab series={series} profileName={profileName} />}

              {activeTab === 'seasons' && (
                drilledSeason !== null ? (
                  <SeasonEpisodesView
                    seriesId={seriesId}
                    seasonNumber={drilledSeason}
                    onBack={() => setDrilledSeason(null)}
                    showMessage={showMessage}
                  />
                ) : (
                  <SeasonsTab
                    seasons={seasons}
                    onDrill={(sn) => setDrilledSeason(sn)}
                    onSearch={handleSeasonSearch}
                    onToggleMonitor={handleSeasonMonitor}
                    busySeason={seasonActionBusy}
                  />
                )
              )}

              {activeTab === 'files' && (
                <FilesContent
                  files={files}
                  loading={filesLoading}
                  deletingFileId={deletingFileId}
                  onDelete={handleDeleteFile}
                />
              )}

              {activeTab === 'history' && (
                <HistoryContent
                  items={history}
                  loading={historyLoading}
                  retrying={retrying}
                  onRetry={handleRetryFailed}
                />
              )}

              {activeTab === 'queue' && (
                <QueueContent
                  items={queue}
                  loading={queueLoading}
                  removing={removingQueue}
                  onRemove={handleRemoveQueue}
                  outcome={searchOutcome}
                  searching={searchPhase === 'searching' || searchPhase === 'polling'}
                />
              )}

              {activeTab === 'blocklist' && (
                <BlocklistContent
                  items={blocklist}
                  loading={blocklistLoading}
                  unblocking={unblocking}
                  onUnblock={handleUnblock}
                />
              )}
            </div>
          </>
        )}
      </div>

      {removeOpen && series && (
        <RemoveSeriesDialog
          title={series.title}
          year={series.year}
          episodeCount={series.statistics?.episodeFileCount ?? 0}
          sizeOnDisk={series.statistics?.sizeOnDisk ?? 0}
          deleteFiles={removeFiles}
          setDeleteFiles={setRemoveFiles}
          addExclusion={removeExclusion}
          setAddExclusion={setRemoveExclusion}
          busy={deleteState === 'loading'}
          onConfirm={handleRemoveSeries}
          onCancel={() => setRemoveOpen(false)}
        />
      )}
    </div>
  );
}

/** A library entry is cheap to re-add; a season of media files is not. The dialog therefore states
 *  exactly what will and will not be touched, and keeps file deletion opt-in. */
function RemoveSeriesDialog({
  title, year, episodeCount, sizeOnDisk,
  deleteFiles, setDeleteFiles,
  addExclusion, setAddExclusion,
  busy, onConfirm, onCancel,
}: {
  title: string;
  year: number;
  episodeCount: number;
  sizeOnDisk: number;
  deleteFiles: boolean;
  setDeleteFiles: (v: boolean) => void;
  addExclusion: boolean;
  setAddExclusion: (v: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const hasFiles = episodeCount > 0;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-md p-5 space-y-4 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold text-ndp-text">Remove from Sonarr</h3>
          <p className="text-sm text-ndp-text-dim mt-1 break-words">
            {title}{year ? ` (${year})` : ''}
          </p>
        </div>

        <p className="text-xs text-ndp-text-dim leading-relaxed">
          Sonarr will stop tracking this series. {hasFiles
            ? 'The episodes on disk are kept unless you ask for them below.'
            : 'There are no episodes on disk, so nothing will be deleted from your storage.'}
        </p>

        <div className="space-y-2">
          {hasFiles && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
                className="mt-0.5 accent-red-500"
              />
              <span className="text-xs">
                <span className="text-ndp-error font-medium">Also delete the episodes on disk</span>
                <span className="block text-ndp-text-dim mt-0.5">
                  Permanently removes {episodeCount} episode{episodeCount === 1 ? '' : 's'}
                  {sizeOnDisk > 0 ? ` (${formatSize(sizeOnDisk)})` : ''}. This cannot be undone.
                </span>
              </span>
            </label>
          )}

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={addExclusion}
              onChange={(e) => setAddExclusion(e.target.checked)}
              className="mt-0.5 accent-indigo-500"
            />
            <span className="text-xs">
              <span className="text-ndp-text font-medium">Add an import exclusion</span>
              <span className="block text-ndp-text-dim mt-0.5">
                Stops a list from re-adding it on the next sync.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-xs font-medium rounded-lg bg-white/10 text-ndp-text-dim hover:bg-white/15 transition-colors disabled:opacity-50 px-3 py-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="text-xs font-medium rounded-lg bg-ndp-error text-white hover:bg-ndp-error/80 transition-colors disabled:opacity-50 px-3 py-2"
          >
            {busy ? 'Removing\u2026' : (deleteFiles ? 'Remove and delete episodes' : 'Remove')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

const SERIES_STATUS_LABEL: Record<string, string> = {
  continuing: 'Continuing',
  ended: 'Ended',
  upcoming: 'Upcoming',
  deleted: 'Removed from TVDB',
};

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function OverviewTab({ series, profileName }: { series: SeriesDetail; profileName: string | null }) {
  const stats = series.statistics;
  const pct = stats ? Math.round(stats.percentOfEpisodes) : 0;
  const statusLabel = SERIES_STATUS_LABEL[series.status] ?? series.status;
  const nextAiring = formatDate(series.nextAiring);

  return (
    <div className="space-y-4">
      {/* Completion is the number an admin actually came for — give it room instead of burying
          it as one cell among six. */}
      {stats && (
        <div className="card p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-ndp-text">
                {stats.episodeFileCount} of {stats.episodeCount} episodes
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 text-[11px] text-ndp-text-dim">{statusLabel}</span>
              {series.seriesType !== 'standard' && (
                <span className="px-2 py-0.5 rounded-full bg-white/5 text-[11px] text-ndp-text-dim capitalize">
                  {series.seriesType}
                </span>
              )}
            </div>
            <span className="text-sm font-semibold text-ndp-accent tabular-nums">{pct}%</span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-ndp-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ndp-text-dim">
            <span>{stats.seasonCount} season{stats.seasonCount === 1 ? '' : 's'}</span>
            <span>{formatSize(stats.sizeOnDisk)} on disk</span>
            {stats.totalEpisodeCount > stats.episodeCount && (
              <span>{stats.totalEpisodeCount} total incl. unmonitored</span>
            )}
            {nextAiring && <span>Next episode {nextAiring}</span>}
          </div>
        </div>
      )}

      <Section title="In Sonarr">
        <Grid>
          {profileName && <Field label="Quality profile">{profileName}</Field>}
          <Field label="Monitored">{series.monitored ? 'Yes' : 'No'}</Field>
          <Field label="Type"><span className="capitalize">{series.seriesType}</span></Field>
          {series.network && <Field label="Network">{series.network}</Field>}
          {series.airTime && <Field label="Air time">{series.airTime}</Field>}
          {series.rootFolderPath
            ? <Field label="Root folder"><span className="break-all">{series.rootFolderPath}</span></Field>
            : <Field label="Path" span><span className="break-all">{series.path}</span></Field>}
          {series.added && <Field label="Added to Sonarr">{formatRelativeDate(series.added)}</Field>}
        </Grid>
      </Section>

      {(series.certification || series.originalLanguage?.name || series.firstAired
        || typeof series.ratings?.value === 'number') && (
        <Section title="About">
          <Grid>
            {series.firstAired && <Field label="First aired">{formatDate(series.firstAired)}</Field>}
            {series.certification && <Field label="Certification">{series.certification}</Field>}
            {series.originalLanguage?.name && <Field label="Original language">{series.originalLanguage.name}</Field>}
            {typeof series.ratings?.value === 'number' && series.ratings.value > 0 && (
              <Field label="Rating">{series.ratings.value}</Field>
            )}
          </Grid>
        </Section>
      )}
    </div>
  );
}

function SeasonsTab({
  seasons, onDrill, onSearch, onToggleMonitor, busySeason,
}: {
  seasons: SeasonSummary[];
  onDrill: (seasonNumber: number) => void;
  onSearch: (seasonNumber: number) => void;
  onToggleMonitor: (seasonNumber: number, monitored: boolean) => void;
  busySeason: number | null;
}) {
  if (seasons.length === 0) {
    return <div className="text-center py-12 text-sm text-ndp-text-dim">No seasons available</div>;
  }

  return (
    <div className="space-y-2">
      {seasons.map((s) => {
        const complete = s.episodeCount > 0 && s.episodeFileCount >= s.episodeCount;
        const pct = Math.round(s.percentOfEpisodes);
        const busy = busySeason === s.seasonNumber;
        return (
          <div key={s.seasonNumber} className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-base font-semibold text-ndp-text">
                    {s.seasonNumber === 0 ? 'Specials' : `Season ${s.seasonNumber}`}
                  </h3>
                  <span
                    className={
                      'inline-block px-2 py-0.5 rounded-full text-xs font-medium ' +
                      (!s.monitored
                        ? 'bg-white/10 text-ndp-text-dim'
                        : complete
                          ? 'bg-ndp-success/15 text-ndp-success'
                          : s.episodeFileCount > 0
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-ndp-error/15 text-ndp-error')
                    }
                  >
                    {!s.monitored ? 'Unmonitored' : complete ? 'Complete' : s.episodeFileCount > 0 ? 'Partial' : 'Missing'}
                  </span>
                  <span className="text-xs text-ndp-text-dim">
                    {s.episodeFileCount}/{s.episodeCount} eps · {pct}%
                  </span>
                  {s.sizeOnDisk > 0 && (
                    <span className="text-xs text-ndp-text-dim">· {formatSize(s.sizeOnDisk)}</span>
                  )}
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mt-2">
                  <div
                    className={'h-full transition-all duration-300 ' + (complete ? 'bg-ndp-success' : 'bg-ndp-accent')}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onDrill(s.seasonNumber)}
                  className="text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-ndp-text transition-colors px-3 py-1.5"
                >
                  Episodes
                </button>
                <button
                  onClick={() => onSearch(s.seasonNumber)}
                  disabled={busy}
                  className="text-xs font-medium rounded-lg bg-ndp-accent/20 text-ndp-accent hover:bg-ndp-accent/30 transition-colors disabled:opacity-50 px-3 py-1.5"
                >
                  {busy ? '…' : 'Search'}
                </button>
                <button
                  onClick={() => onToggleMonitor(s.seasonNumber, !s.monitored)}
                  disabled={busy}
                  className={
                    'text-xs font-medium rounded-lg transition-colors disabled:opacity-50 px-3 py-1.5 ' +
                    (s.monitored
                      ? 'bg-white/10 hover:bg-white/15 text-ndp-text'
                      : 'bg-ndp-accent/20 hover:bg-ndp-accent/30 text-ndp-accent')
                  }
                >
                  {s.monitored ? 'Unmonitor' : 'Monitor'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilesContent({
  files, loading, deletingFileId, onDelete,
}: {
  files: EpisodeFile[] | null;
  loading: boolean;
  deletingFileId: number | null;
  onDelete: (fileId: number) => void;
}) {
  if (loading && files === null) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!files || files.length === 0) {
    return <div className="text-center py-12 text-sm text-ndp-text-dim">No episode files yet.</div>;
  }
  const sorted = [...files].sort((a, b) => a.seasonNumber - b.seasonNumber || a.path.localeCompare(b.path));
  return (
    <div className="space-y-2">
      {sorted.map((f) => (
        <div key={f.id} className="card p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-ndp-text break-all leading-snug">{f.relativePath || f.path}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-ndp-text-dim">
              <span className="text-ndp-text">S{String(f.seasonNumber).padStart(2, '0')}</span>
              <span>·</span>
              <span>{f.quality?.quality?.name || '—'}</span>
              <span>·</span>
              <span>{formatSize(f.size)}</span>
              {f.mediaInfo?.videoCodec && (<><span>·</span><span>{f.mediaInfo.videoCodec}</span></>)}
              {f.mediaInfo?.resolution && (<><span>·</span><span>{f.mediaInfo.resolution}</span></>)}
              {f.mediaInfo?.audioLanguages && (<><span>·</span><span>{f.mediaInfo.audioLanguages}</span></>)}
              <span>·</span>
              <span>{formatRelativeDate(f.dateAdded)}</span>
            </div>
          </div>
          <button
            onClick={() => onDelete(f.id)}
            disabled={deletingFileId === f.id}
            className="flex-shrink-0 rounded-lg text-xs font-medium bg-ndp-error/10 text-ndp-error hover:bg-ndp-error/20 transition-colors disabled:opacity-50 px-3 py-1.5"
          >
            {deletingFileId === f.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ))}
    </div>
  );
}

function HistoryContent({
  items, loading, retrying, onRetry,
}: {
  items: HistoryItem[] | null;
  loading: boolean;
  retrying: number | null;
  onRetry: (id: number) => void;
}) {
  if (loading && items === null) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!items || items.length === 0) {
    return <div className="text-center py-12 text-sm text-ndp-text-dim">No history events for this series yet.</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const meta = eventMeta(item.eventType);
        const isFailed = item.eventType === 'downloadFailed';
        return (
          <div key={item.id} className="card p-3 flex items-start gap-3">
            <span className={`flex-shrink-0 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
              {meta.label}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-ndp-text break-all leading-snug">{item.sourceTitle}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-ndp-text-dim">
                {item.episode && <span className="font-mono text-ndp-text">{epTag(item.episode)}</span>}
                {item.episode?.title && (<><span>·</span><span>{item.episode.title}</span></>)}
                <span>·</span>
                <span className="text-ndp-text">{item.quality?.quality?.name || '—'}</span>
                <span>·</span>
                <span>{formatRelativeDate(item.date)}</span>
                {item.data?.downloadClient && (<><span>·</span><span>{item.data.downloadClient}</span></>)}
                {item.data?.reason && (<><span>·</span><span className="text-ndp-error/80">{item.data.reason}</span></>)}
              </div>
            </div>
            {isFailed && (
              <button
                onClick={() => onRetry(item.id)}
                disabled={retrying === item.id}
                className="flex-shrink-0 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50 px-3 py-1.5"
              >
                {retrying === item.id ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** `status` says "downloading" even for a finished download stuck at import. `trackedDownloadState`
 *  is the one that tells the truth, and `trackedDownloadStatus` says whether it needs attention. */
const QUEUE_STATE_LABEL: Record<string, string> = {
  downloading: 'Downloading',
  importPending: 'Waiting to import',
  importBlocked: 'Import blocked',
  importing: 'Importing',
  imported: 'Imported',
  failedPending: 'Failed',
  failed: 'Failed',
  ignored: 'Ignored',
};

function queueBadge(item: QueueItem): { label: string; className: string } {
  const state = item.trackedDownloadState;
  const label = (state && QUEUE_STATE_LABEL[state]) || state || item.status;
  const className = {
    error: 'bg-red-500/15 text-red-300',
    warning: 'bg-amber-500/15 text-amber-300',
  }[item.trackedDownloadStatus ?? ''] ?? 'bg-sky-500/15 text-sky-300';
  return { label, className };
}

function QueueContent({
  items, loading, removing, onRemove, outcome, searching,
}: {
  items: QueueItem[] | null;
  loading: boolean;
  removing: number | null;
  onRemove: (id: number, blocklistFlag: boolean) => void;
  outcome: SearchOutcome | null;
  searching: boolean;
}) {
  if (searching) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <div className="w-6 h-6 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-ndp-text-dim">Sonarr is searching your indexers…</p>
      </div>
    );
  }
  if (loading && items === null) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!items || items.length === 0) {
    // An empty queue right after a search is a result, not an absence — say which.
    if (outcome?.kind === 'nothing') {
      return (
        <div className="text-center py-12 px-6 space-y-3">
          <p className="text-sm font-medium text-ndp-text">Sonarr grabbed nothing</p>
          <p className="text-xs text-ndp-text-dim max-w-sm mx-auto leading-relaxed">
            {outcome.reason
              || 'Every release it found was rejected — usually because the episodes on disk already meet your quality cutoff, or no candidate passed your profile.'}
          </p>
        </div>
      );
    }
    return <div className="text-center py-12 text-sm text-ndp-text-dim">Nothing in the download queue for this series.</div>;
  }
  return (
    <div className="space-y-3">
      {outcome?.kind === 'grabbed' && (
        <div className="rounded-xl border border-ndp-success/20 bg-ndp-success/10 px-4 py-3">
          <p className="text-xs font-semibold text-ndp-success">
            Sonarr grabbed {outcome.titles.length === 1 ? '1 episode' : `${outcome.titles.length} episodes`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {outcome.titles.map((title) => (
              <li key={title} className="text-[11px] text-ndp-text-dim break-all leading-snug">{title}</li>
            ))}
          </ul>
        </div>
      )}
      {items.map((item) => {
        const total = item.size || 0;
        const left = item.sizeleft || 0;
        const done = Math.max(0, total - left);
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        return (
          <div key={item.id} className="card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-ndp-text break-all leading-snug flex-1 min-w-0">{item.title}</p>
                  {item.episode && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-ndp-text-dim">
                      {epTag(item.episode)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-ndp-text-dim">
                  <span className="text-ndp-text">{item.quality?.quality?.name || '—'}</span>
                  <span>·</span>
                  <span>{formatSize(total)}</span>
                  <span>·</span>
                  <span>{item.downloadClient || '—'}</span>
                  <span>·</span>
                  <span className="uppercase tracking-wider">{item.protocol}</span>
                  {item.timeleft && (<><span>·</span><span>ETA {item.timeleft}</span></>)}
                </div>
              </div>
              <span className={`flex-shrink-0 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${queueBadge(item).className}`}>
                {queueBadge(item).label}
              </span>
            </div>

            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-ndp-accent transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-ndp-text-dim">
              <span>{formatSize(done)} / {formatSize(total)}</span>
              <span className="font-semibold text-ndp-accent">{pct}%</span>
            </div>

            {item.statusMessages && item.statusMessages.length > 0 && (
              <ul className="border-t border-white/5 pt-2 space-y-1">
                {item.statusMessages.flatMap((m) =>
                  m.messages.map((msg, i) => (
                    <li key={`${m.title}-${i}`} className="text-[11px] text-amber-300/80 flex items-start gap-1.5">
                      <span className="text-amber-400 mt-0.5">⚠</span>
                      <span>{msg}</span>
                    </li>
                  )),
                )}
              </ul>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onRemove(item.id, false)}
                disabled={removing === item.id}
                className="rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-ndp-text transition-colors disabled:opacity-50 px-3 py-1.5"
              >
                {removing === item.id ? 'Removing…' : 'Remove'}
              </button>
              <button
                onClick={() => onRemove(item.id, true)}
                disabled={removing === item.id}
                className="rounded-lg text-xs font-medium bg-ndp-error/10 hover:bg-ndp-error/20 text-ndp-error transition-colors disabled:opacity-50 px-3 py-1.5"
              >
                Remove & Blocklist
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlocklistContent({
  items, loading, unblocking, onUnblock,
}: {
  items: BlocklistItem[] | null;
  loading: boolean;
  unblocking: number | null;
  onUnblock: (id: number) => void;
}) {
  if (loading && items === null) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!items || items.length === 0) {
    return <div className="text-center py-12 text-sm text-ndp-text-dim">No blocklisted releases for this series.</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="card p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-ndp-text break-all leading-snug">{item.sourceTitle}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-ndp-text-dim">
              <span className="text-ndp-text">{item.quality?.quality?.name || '—'}</span>
              <span>·</span>
              <span>{formatRelativeDate(item.date)}</span>
              {item.message && (<><span>·</span><span className="text-ndp-error/80">{item.message}</span></>)}
            </div>
          </div>
          <button
            onClick={() => onUnblock(item.id)}
            disabled={unblocking === item.id}
            className="flex-shrink-0 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-ndp-text transition-colors disabled:opacity-50 px-3 py-1.5"
          >
            {unblocking === item.id ? 'Removing…' : 'Unblock'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Shared layout bits
// ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ndp-text-dim">{title}</h3>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="card p-4 text-sm grid gap-y-2 gap-x-6"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
    >
      {children}
    </div>
  );
}

function Field({ label, children, span = false }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
      <span className="text-ndp-text-dim">{label}: </span>
      <span className="text-ndp-text">{children}</span>
    </div>
  );
}

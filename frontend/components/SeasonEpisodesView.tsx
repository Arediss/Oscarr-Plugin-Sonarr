import React, { useEffect, useState, useCallback } from 'react';
import { EpisodeReleasesModal } from './EpisodeReleasesModal';

interface Episode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  airDateUtc?: string | null;
  hasFile: boolean;
  monitored: boolean;
  episodeFile?: {
    quality: { quality: { id: number; name: string } };
    size: number;
  } | null;
}

interface SeasonEpisodesViewProps {
  seriesId: number;
  seasonNumber: number;
  onBack: () => void;
  showMessage: (text: string, type: 'success' | 'error') => void;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatAirDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function epTag(s: number, e: number): string {
  return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
}

export function SeasonEpisodesView({ seriesId, seasonNumber, onBack, showMessage }: SeasonEpisodesViewProps) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'none' | 'search' | 'monitor' | 'unmonitor'>('none');
  // Which episode's release list is open, if any.
  const [releasesFor, setReleasesFor] = useState<{ id: number; label: string } | null>(null);

  const loadEpisodes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/plugins/sonarr/series/${seriesId}/episodes?seasonNumber=${seasonNumber}`,
        { credentials: 'include' },
      );
      if (!r.ok) throw new Error();
      const data = await r.json();
      const raw: Episode[] = Array.isArray(data?.episodes) ? data.episodes : [];
      const list = [...raw].sort((a, b) => a.episodeNumber - b.episodeNumber);
      setEpisodes(list);
    } catch {
      showMessage('Failed to load episodes', 'error');
    }
    setLoading(false);
  }, [seriesId, seasonNumber, showMessage]);

  useEffect(() => { loadEpisodes(); }, [loadEpisodes]);

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === episodes.length) return new Set();
      return new Set(episodes.map((e) => e.id));
    });
  };

  const searchSelected = async () => {
    if (selected.size === 0) return;
    setBusy('search');
    try {
      const r = await fetch('/api/plugins/sonarr/episodes/search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [...selected] }),
      });
      if (!r.ok) throw new Error();
      showMessage(`Search sent for ${selected.size} episode${selected.size !== 1 ? 's' : ''}`, 'success');
    } catch {
      showMessage('Search command failed', 'error');
    }
    setBusy('none');
  };

  const setMonitored = async (monitored: boolean) => {
    if (selected.size === 0) return;
    setBusy(monitored ? 'monitor' : 'unmonitor');
    try {
      const r = await fetch('/api/plugins/sonarr/episodes/monitor', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [...selected], monitored }),
      });
      if (!r.ok) throw new Error();
      setEpisodes((prev) =>
        prev.map((e) => (selected.has(e.id) ? { ...e, monitored } : e)),
      );
      showMessage(`${selected.size} episode${selected.size !== 1 ? 's' : ''} ${monitored ? 'monitored' : 'unmonitored'}`, 'success');
    } catch {
      showMessage('Failed to toggle monitoring', 'error');
    }
    setBusy('none');
  };

  const searchSingle = async (episodeId: number) => {
    try {
      const r = await fetch('/api/plugins/sonarr/episodes/search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [episodeId] }),
      });
      if (!r.ok) throw new Error();
      showMessage('Search sent', 'success');
    } catch {
      showMessage('Search failed', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const allSelected = selected.size === episodes.length && episodes.length > 0;

  return (
    <>
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-xs text-ndp-text-dim hover:text-ndp-text transition-colors inline-flex items-center gap-1"
        >
          <span>←</span> Back to seasons
        </button>
        <span className="text-xs text-ndp-text-dim">
          {seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`} · {episodes.length} episode{episodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Bulk action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-ndp-text-dim cursor-pointer">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-ndp-accent" />
          Select all
        </label>
        <span className="text-xs text-ndp-text-dim">{selected.size} selected</span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={searchSelected}
            disabled={selected.size === 0 || busy !== 'none'}
            className="text-xs font-medium rounded-lg bg-ndp-accent/20 text-ndp-accent hover:bg-ndp-accent/30 transition-colors disabled:opacity-40 px-3 py-1.5"
          >
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
          <button
            onClick={() => setMonitored(true)}
            disabled={selected.size === 0 || busy !== 'none'}
            className="text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-ndp-text transition-colors disabled:opacity-40 px-3 py-1.5"
          >
            Monitor
          </button>
          <button
            onClick={() => setMonitored(false)}
            disabled={selected.size === 0 || busy !== 'none'}
            className="text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-ndp-text-dim transition-colors disabled:opacity-40 px-3 py-1.5"
          >
            Unmonitor
          </button>
        </div>
      </div>

      {/* Episode list */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-2 w-[36px]"></th>
                <th className="text-left px-3 py-2 text-ndp-text-dim font-medium w-[80px]">Episode</th>
                <th className="text-left px-3 py-2 text-ndp-text-dim font-medium">Title</th>
                <th className="text-left px-3 py-2 text-ndp-text-dim font-medium w-[110px]">Air date</th>
                <th className="text-left px-3 py-2 text-ndp-text-dim font-medium w-[80px]">Status</th>
                <th className="text-left px-3 py-2 text-ndp-text-dim font-medium w-[110px]">Quality</th>
                <th className="text-right px-3 py-2 text-ndp-text-dim font-medium w-[80px]">Size</th>
                <th className="text-right px-3 py-2 text-ndp-text-dim font-medium w-[90px]"></th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep) => {
                const quality = ep.episodeFile?.quality?.quality?.name || '-';
                const size = ep.episodeFile?.size || 0;
                const checked = selected.has(ep.id);
                return (
                  <tr key={ep.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(ep.id)}
                        className="accent-ndp-accent"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-ndp-text-dim">
                      {epTag(ep.seasonNumber, ep.episodeNumber)}
                    </td>
                    <td className="px-3 py-2 text-ndp-text">
                      {ep.title || '—'}
                      {!ep.monitored && (
                        <span className="ml-2 text-[10px] text-ndp-text-dim">(unmonitored)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ndp-text-dim">{formatAirDate(ep.airDateUtc)}</td>
                    <td className="px-3 py-2">
                      {ep.hasFile ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-ndp-success/15 text-ndp-success">
                          On disk
                        </span>
                      ) : ep.monitored ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-ndp-error/15 text-ndp-error">
                          Missing
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-ndp-text-dim">
                          Skipped
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ndp-text-dim">{quality}</td>
                    <td className="px-3 py-2 text-right text-xs text-ndp-text-dim">
                      {size > 0 ? formatSize(size) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => searchSingle(ep.id)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-ndp-accent/20 text-ndp-accent hover:bg-ndp-accent/30 transition-colors"
                      >
                        Auto
                      </button>
                      <button
                        onClick={() => setReleasesFor({ id: ep.id, label: `S${String(seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}` })}
                        title="List releases from your indexers. Nothing is downloaded until you pick one."
                        className="text-xs px-2.5 py-1 rounded-lg bg-white/5 text-ndp-text hover:bg-white/10 transition-colors ml-1.5"
                      >
                        Releases
                      </button>
                    </td>
                  </tr>
                );
              })}
              {episodes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-ndp-text-dim">
                    No episodes in this season.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>

      {releasesFor && (
        <EpisodeReleasesModal
          episodeId={releasesFor.id}
          label={releasesFor.label}
          onClose={() => setReleasesFor(null)}
          showMessage={showMessage}
        />
      )}
    </>
  );
}

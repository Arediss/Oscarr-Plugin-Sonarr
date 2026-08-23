import React, { useCallback, useEffect, useState } from 'react';

interface Release {
  guid: string;
  title: string;
  indexer: string;
  indexerId?: number;
  size: number;
  seeders?: number;
  leechers?: number;
  age?: number;
  quality?: { quality?: { name?: string } };
  protocol?: string;
  approved?: boolean;
  fullSeason?: boolean;
  rejections?: string[];
}

interface Props {
  episodeId: number;
  label: string;
  onClose: () => void;
  showMessage: (text: string, kind: 'success' | 'error') => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Interactive search for one episode.
 *
 * The Search button next to an episode runs Sonarr's EpisodeSearch command, which picks and grabs
 * on its own. That is the right tool when you trust the profile and the wrong one when an earlier
 * automatic grab is exactly what went wrong. This lists what the indexers hold and grabs nothing
 * until a row is clicked.
 */
export function EpisodeReleasesModal({ episodeId, label, onClose, showMessage }: Readonly<Props>) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/plugins/sonarr/releases?episodeId=${episodeId}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setReleases(await r.json());
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch releases');
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => { void load(); }, [load]);

  const grab = async (release: Release) => {
    setGrabbing(release.guid);
    try {
      const r = await fetch('/api/plugins/sonarr/releases/grab', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid: release.guid, indexerId: release.indexerId || 0 }),
      });
      if (!r.ok) throw new Error('Grab failed');
      setGrabbed((prev) => new Set(prev).add(release.guid));
      showMessage('Release grabbed', 'success');
    } catch {
      showMessage('Failed to grab release', 'error');
    } finally {
      setGrabbing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-ndp-bg rounded-2xl w-full max-w-4xl max-h-[80vh] shadow-2xl shadow-black/60 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ndp-text truncate">Releases — {label}</h3>
            <p className="text-xs text-ndp-text-dim mt-0.5">Nothing is downloaded until you pick one.</p>
          </div>
          <button onClick={onClose} className="text-ndp-text-dim hover:text-ndp-text text-sm px-2">Close</button>
        </div>

        <div className="overflow-y-auto flex-1 p-3">
          {loading && <p className="text-center text-sm text-ndp-text-dim py-10">Asking your indexers…</p>}
          {!loading && error && <p className="text-center text-sm text-ndp-error py-10">{error}</p>}
          {!loading && !error && releases.length === 0 && (
            <p className="text-center text-sm text-ndp-text-dim py-10">No releases found for this episode.</p>
          )}

          {releases.map((release) => {
            const done = grabbed.has(release.guid);
            const rejected = (release.rejections?.length ?? 0) > 0;
            return (
              <div key={release.guid} className="rounded-lg bg-white/[0.03] px-3 py-2.5 mb-1.5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ndp-text break-words">{release.title}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-ndp-text-dim">
                      <span>{release.quality?.quality?.name ?? 'Unknown'}</span>
                      <span>{formatSize(release.size)}</span>
                      <span>{release.indexer}</span>
                      {release.protocol === 'torrent' && <span>{release.seeders ?? 0} seeders</span>}
                      {release.age !== undefined && <span>{release.age}d old</span>}
                      {release.fullSeason && <span className="text-ndp-accent">full season</span>}
                    </div>
                    {/* Sonarr's own reasons for refusing it — the admin decides whether they matter. */}
                    {rejected && (
                      <p className="text-[11px] text-yellow-500 mt-1">{release.rejections!.join(' · ')}</p>
                    )}
                  </div>
                  <button
                    onClick={() => grab(release)}
                    disabled={grabbing !== null || done}
                    className={
                      'flex-shrink-0 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ' +
                      (done
                        ? 'bg-ndp-success/15 text-ndp-success cursor-default'
                        : 'bg-ndp-accent text-white hover:bg-ndp-accent/90')
                    }
                  >
                    {done ? 'Grabbed' : grabbing === release.guid ? 'Grabbing…' : 'Grab'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

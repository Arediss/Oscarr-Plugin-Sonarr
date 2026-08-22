import React, { useState, useEffect } from 'react';

interface AnalyticsData {
  overview: {
    totalSeries: number;
    totalEpisodes: number;
    totalFiles: number;
    totalSize: number;
    complete: number;
    missing: number;
    unmonitored: number;
    continuing: number;
    ended: number;
  };
  seriesTypeCounts: { name: string; count: number }[];
  diskSpace: {
    path: string;
    label: string;
    freeSpace: number;
    totalSpace: number;
    usedSpace: number;
    usedPercent: number;
    quotaBytes: number | null;
    effectiveFree: number;
    quotaLimited: boolean;
  }[];
  timeline: { month: string; count: number }[];
  rootFolders: { path: string; count: number; size: number }[];
  topBySize: { id: number; title: string; year: number; size: number; episodeFileCount: number }[];
  profileMap: Record<number, string>;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatSizeTB(bytes: number): string {
  const tb = bytes / Math.pow(1024, 4);
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  return formatSize(bytes);
}

function formatMonth(key: string): string {
  const [year, month] = key.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(month) - 1]} ${year.slice(2)}`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  accent?: string;
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div className="card p-5">
      <p className="text-sm text-ndp-text-dim">{label}</p>
      <p className={'text-2xl font-bold mt-1 ' + (accent || 'text-ndp-text')}>{value}</p>
    </div>
  );
}

export function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after saving a cap, so the bars re-read the figures that just changed.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/plugins/sonarr/analytics', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-ndp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card p-6 text-center">
        <p className="text-ndp-error">{error || 'No data available'}</p>
      </div>
    );
  }

  const maxTimelineCount = Math.max(...data.timeline.map((t) => t.count), 1);
  const maxSeriesTypeCount = Math.max(...data.seriesTypeCounts.map((q) => q.count), 1);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total Series" value={data.overview.totalSeries.toLocaleString()} />
        <StatCard label="Total Size" value={formatSizeTB(data.overview.totalSize)} />
        <StatCard
          label="Episodes"
          value={`${data.overview.totalFiles.toLocaleString()} / ${data.overview.totalEpisodes.toLocaleString()}`}
        />
        <StatCard label="Complete" value={data.overview.complete.toLocaleString()} accent="text-ndp-success" />
        <StatCard label="Missing" value={data.overview.missing.toLocaleString()} accent="text-ndp-error" />
        <StatCard label="Unmonitored" value={data.overview.unmonitored.toLocaleString()} accent="text-ndp-text-dim" />
        <StatCard label="Continuing" value={data.overview.continuing.toLocaleString()} accent="text-ndp-accent" />
        <StatCard label="Ended" value={data.overview.ended.toLocaleString()} accent="text-ndp-text-dim" />
      </div>

      {/* Disk Space */}
      {data.diskSpace.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-ndp-text">Disk Space</h3>
            <QuotaEditor disks={data.diskSpace} onSaved={() => setReloadToken((n) => n + 1)} />
          </div>
          <div className="card p-5 space-y-4">
            {data.diskSpace.map((disk) => (
              <div key={disk.path}>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-ndp-text truncate" title={disk.path}>
                    {disk.label || disk.path}
                  </span>
                  <span className="text-ndp-text-dim flex-shrink-0 ml-3">
                    {formatSize(disk.usedSpace)} / {formatSize(disk.totalSpace)} ({disk.usedPercent}%)
                  </span>
                </div>
                {disk.quotaLimited && (
                  <p className="mb-1.5 text-xs text-yellow-500">
                    Quota caps this folder at {formatSize(disk.quotaBytes ?? 0)} — {formatSize(disk.effectiveFree)} writable,
                    not the {formatSize(disk.freeSpace)} the filesystem reports.
                  </p>
                )}
                <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={
                      'h-full rounded-full transition-all duration-500 ' +
                      (disk.usedPercent > 90
                        ? 'bg-ndp-error'
                        : disk.usedPercent > 70
                          ? 'bg-yellow-500'
                          : 'bg-ndp-accent')
                    }
                    style={{ width: `${Math.min(disk.usedPercent, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Series Type Distribution */}
      {data.seriesTypeCounts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ndp-text">Series Type</h3>
          <div className="card p-5 space-y-3">
            {data.seriesTypeCounts.map((q) => (
              <div key={q.name}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-ndp-text capitalize">{q.name}</span>
                  <span className="text-ndp-text-dim">{q.count}</span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ndp-accent rounded-full transition-all duration-500"
                    style={{ width: `${(q.count / maxSeriesTypeCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      {data.timeline.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ndp-text">Series Added (Last 12 Months)</h3>
          <div className="card p-5">
            <div className="flex items-end gap-1.5 h-40">
              {data.timeline.map((t) => (
                <div key={t.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-[10px] text-ndp-text-dim">{t.count > 0 ? t.count : ''}</span>
                  <div
                    className="w-full bg-ndp-accent/80 rounded-t transition-all duration-500 min-h-[2px]"
                    style={{
                      height: t.count > 0 ? `${Math.max((t.count / maxTimelineCount) * 100, 5)}%` : '2px',
                    }}
                  />
                  <span className="text-[9px] text-ndp-text-dim whitespace-nowrap">{formatMonth(t.month)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top series by size */}
      {data.topBySize.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ndp-text">Largest Series</h3>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-4 py-3 text-ndp-text-dim font-medium">Series</th>
                  <th className="text-right px-4 py-3 text-ndp-text-dim font-medium w-[120px]">Episodes</th>
                  <th className="text-right px-4 py-3 text-ndp-text-dim font-medium w-[100px]">Size</th>
                </tr>
              </thead>
              <tbody>
                {data.topBySize.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <span className="text-ndp-text font-medium">{s.title}</span>
                      {s.year ? <span className="text-ndp-text-dim ml-1.5 text-xs">({s.year})</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right text-ndp-text-dim">{s.episodeFileCount}</td>
                    <td className="px-4 py-3 text-right text-ndp-text-dim">{formatSize(s.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Root Folders */}
      {data.rootFolders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ndp-text">Root Folders</h3>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-4 py-3 text-ndp-text-dim font-medium">Path</th>
                  <th className="text-right px-4 py-3 text-ndp-text-dim font-medium w-[100px]">Series</th>
                  <th className="text-right px-4 py-3 text-ndp-text-dim font-medium w-[100px]">Size</th>
                </tr>
              </thead>
              <tbody>
                {data.rootFolders.map((rf) => (
                  <tr key={rf.path} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 text-ndp-text break-all">{rf.path}</td>
                    <td className="px-4 py-3 text-right text-ndp-text-dim">{rf.count}</td>
                    <td className="px-4 py-3 text-right text-ndp-text-dim">{formatSize(rf.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const GIB = 1024 ** 3;
const BASE = '/api/plugins/sonarr';

/** Declared storage caps, per root folder.
 *
 *  Radarr and Sonarr report what the filesystem says. A *user* quota sits above that and is
 *  invisible to them, so an operator with 3 TB free on paper can still hit a wall. Reading the
 *  real quota would mean running `quota` as the owning user on the host that holds the media —
 *  Oscarr is in its own container, without the library mounted. So the admin declares it. */
function QuotaEditor({ disks, onSaved }: Readonly<{
  disks: { path: string; label: string; quotaBytes: number | null }[];
  onSaved: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    const initial: Record<string, string> = {};
    for (const d of disks) initial[d.path] = d.quotaBytes ? String(Math.round(d.quotaBytes / GIB)) : '';
    setDraft(initial);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const quotas: Record<string, number> = {};
      for (const [path, value] of Object.entries(draft)) {
        const gib = Number(value);
        // Blank or zero means "no cap" — the backend drops anything not strictly positive.
        if (Number.isFinite(gib) && gib > 0) quotas[path] = Math.round(gib * GIB);
      }
      const res = await fetch(`${BASE}/quotas`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotas }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={start} className="text-xs text-ndp-accent hover:text-ndp-accent/80 transition-colors">
        Set storage caps
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
      <p className="text-xs text-ndp-text-dim">
        Leave blank when a folder has no quota. Values are in GiB; the bar then shows whichever
        limit binds first.
      </p>
      {disks.map((d) => (
        <div key={d.path} className="flex items-center gap-3">
          <span className="flex-1 truncate text-xs text-ndp-text" title={d.path}>{d.label || d.path}</span>
          <input
            type="number"
            min={0}
            value={draft[d.path] ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, [d.path]: e.target.value }))}
            placeholder="no cap"
            className="input w-32 text-sm"
          />
          <span className="text-xs text-ndp-text-dim">GiB</span>
        </div>
      ))}
      {error && <p className="text-xs text-ndp-error">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary text-xs px-3 py-1.5">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-ndp-text-dim hover:text-ndp-text px-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

import React from 'react';
import { useAnalytics } from '../components/AnalyticsViews';
import type { StorageDisk } from '../components/StoragePanel';
import { formatBytes } from '../storage';

interface Overview {
  totalSize: number;
  missing: number;
  totalSeries: number; totalFiles: number;
}
interface WidgetData { overview: Overview; diskSpace: StorageDisk[] }

export default function SonarrOverviewWidget() {
  const { data, error, loading, reload } = useAnalytics<WidgetData>('/api/plugins/sonarr', 120_000);
  // Keep mounts separate: different paths can point to the same filesystem.
  const disks = data ? [...data.diskSpace].sort((a, b) => b.usedPercent - a.usedPercent).slice(0, 2) : [];
  return <section className="arr-widget card" aria-label="Sonarr overview">
    <header className="arr-widget-header">
      <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="2" y="7" width="20" height="15" rx="3" /><path d="m7 2 5 5 5-5" />
      </svg>Sonarr</h2>
      <button type="button" className="arr-widget-refresh" onClick={reload} disabled={loading} aria-label="Refresh Sonarr overview" title="Refresh">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" />
        </svg>
      </button>
    </header>
    <div className="arr-widget-body">
      {error && <p className="arr-widget-error" role="alert">{data ? 'Could not refresh. Showing the last available data.' : error}</p>}
      {!data && loading && <p className="arr-empty" role="status">Loading Sonarr…</p>}
      {data && <>
        <div className="arr-widget-stats">
          <div><span>Series</span><strong>{data.overview.totalSeries.toLocaleString()}</strong></div>
          <div><span>Library size</span><strong>{formatBytes(data.overview.totalSize)}</strong></div>
          <div><span>Episodes on disk</span><strong className="arr-widget-success">{data.overview.totalFiles.toLocaleString()}</strong></div>
          <div><span>Series with missing episodes</span><strong className={data.overview.missing > 0 ? 'arr-widget-warning' : ''}>{data.overview.missing.toLocaleString()}</strong></div>
        </div>
        <div className="arr-widget-storage">
          <h3>Filesystem usage</h3>
          {disks.length === 0 ? <p className="arr-empty">No disks reported.</p> : disks.map(disk => {
            const percent = Math.max(0, Math.min(100, disk.usedPercent));
            return <div className="arr-widget-disk" key={disk.path}>
              <div><span title={disk.path}>{disk.label || disk.path}</span><strong>{percent}% used</strong></div>
              <div className={'arr-meter' + (percent > 90 ? ' arr-meter-danger' : percent > 70 ? ' arr-meter-warning' : '')}
                role="meter" aria-label={`Filesystem usage for ${disk.path}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <span style={{ width: `${percent}%` }} />
              </div>
              <p>{formatBytes(disk.freeSpace)} free{disk.quotaBytes !== null && <> · Declared limit {formatBytes(disk.quotaBytes)}</>}</p>
            </div>;
          })}
          <p className="arr-widget-footnote">Linux user quota remaining is not reported.</p>
        </div>
      </>}
    </div>
    <footer className="arr-widget-footer">
      <a href="/admin?tab=plugin%3Asonarr#library">Open library <span aria-hidden="true">↗</span></a>
      <a href="/admin?tab=plugin%3Asonarr#analytics">Storage &amp; analytics <span aria-hidden="true">→</span></a>
    </footer>
  </section>;
}

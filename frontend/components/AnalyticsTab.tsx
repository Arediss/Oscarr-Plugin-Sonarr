import React from 'react';
import { StoragePanel, type StorageDisk } from './StoragePanel';
import { AnalyticsStatus, Distribution, RootFolders, StatCard, Timeline, useAnalytics } from './AnalyticsViews';
import { formatBytes } from '../storage';

interface AnalyticsData {
  overview: { totalSeries: number; totalEpisodes: number; totalFiles: number; totalSize: number; complete: number; missing: number; unmonitored: number; continuing: number; ended: number };
  seriesTypeCounts: { name: string; count: number }[];
  diskSpace: StorageDisk[];
  timeline: { month: string; count: number }[];
  rootFolders: { path: string; count: number; size: number }[];
  topBySize: { id: number; title: string; year: number; size: number; episodeFileCount: number }[];
}

const BASE = '/api/plugins/sonarr';

export function AnalyticsTab() {
  const { data, error, loading, reload } = useAnalytics<AnalyticsData>(BASE);
  return <div className="arr-analytics">
    <AnalyticsStatus error={error} loading={loading} reload={reload} />
    {data && <>
      <div className="arr-stats arr-stats-series">
        <StatCard label="Total series" value={data.overview.totalSeries.toLocaleString()} />
        <StatCard label="Library size" value={formatBytes(data.overview.totalSize)} />
        <StatCard label="Episodes on disk" value={data.overview.totalFiles.toLocaleString() + ' / ' + data.overview.totalEpisodes.toLocaleString()} />
        <StatCard label="Complete" value={data.overview.complete.toLocaleString()} tone="success" />
        <StatCard label="Missing" value={data.overview.missing.toLocaleString()} tone="danger" />
        <StatCard label="Unmonitored" value={data.overview.unmonitored.toLocaleString()} />
        <StatCard label="Continuing" value={data.overview.continuing.toLocaleString()} />
        <StatCard label="Ended" value={data.overview.ended.toLocaleString()} />
      </div>
      <StoragePanel disks={data.diskSpace} base={BASE} service="Sonarr" onSaved={reload} />
      <div className="arr-chart-grid">
        <Distribution title="Series types" rows={data.seriesTypeCounts} />
        <Timeline title="Series added" rows={data.timeline} />
      </div>
      {data.topBySize.length > 0 && <section className="arr-section">
        <div className="arr-section-heading"><div><h2>Largest series</h2><p>Storage used by library files</p></div></div>
        <div className="arr-table-scroll"><table className="arr-table">
          <thead><tr><th scope="col">Series</th><th scope="col">Episodes</th><th scope="col">Library size</th></tr></thead>
          <tbody>{data.topBySize.map(series => <tr key={series.id}>
            <th scope="row">{series.title}{series.year ? <span className="arr-table-muted"> ({series.year})</span> : null}</th>
            <td>{series.episodeFileCount.toLocaleString()}</td><td>{formatBytes(series.size)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      <RootFolders rows={data.rootFolders} itemLabel="Series" />
    </>}
  </div>;
}

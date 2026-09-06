import React, { useEffect, useState } from 'react';
import { formatBytes } from '../storage';

export function useAnalytics<T>(base: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      if (document.hidden) timer = setTimeout(poll, refreshMs);
      else load();
    };
    const load = () => {
      setLoading(true);
      setError('');
      fetch(base + '/analytics', { credentials: 'include', signal: controller.signal })
        .then(response => {
          if (!response.ok) throw new Error(`Could not load analytics (HTTP ${response.status}).`);
          return response.json();
        })
        .then(result => { if (!controller.signal.aborted) setData(result); })
        .catch(err => { if (!controller.signal.aborted) setError(err.message); })
        .finally(() => {
          if (controller.signal.aborted) return;
          setLoading(false);
          if (refreshMs > 0) timer = setTimeout(poll, refreshMs);
        });
    };
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, revision, refreshMs]);
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}

export function AnalyticsStatus({ error, loading, reload }: { error: string; loading: boolean; reload: () => void }) {
  if (error) return <div className="arr-feedback arr-error" role="alert"><span>{error}</span><button type="button" className="arr-button" onClick={reload}>Retry</button></div>;
  return loading ? <p className="arr-loading" role="status"><span className="arr-spinner" />Updating analytics…</p> : null;
}

export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <div className={'arr-stat ' + (tone ? 'arr-stat-' + tone : '')}><span>{label}</span><strong>{value}</strong></div>;
}

export function Distribution({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...rows.map(row => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const visible = expanded ? rows : rows.slice(0, 6);
  return <section className="arr-section">
    <div className="arr-section-heading"><div><h2>{title}</h2><p>{total.toLocaleString()} items · {rows.length} types</p></div></div>
    {rows.length === 0 ? <p className="arr-empty">No distribution data yet.</p> :
      <div className="arr-distribution">{visible.map(row => <div key={row.name}>
        <div className="arr-chart-label"><span>{row.name}</span><strong>{row.count.toLocaleString()}<small>{total ? Math.round(row.count / total * 100) : 0}%</small></strong></div>
        <div className="arr-meter"><span style={{ width: `${row.count / max * 100}%` }} /></div>
      </div>)}</div>}
    {rows.length > 6 && <button type="button" className="arr-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show fewer' : `Show all ${rows.length} types`}
    </button>}
  </section>;
}

export function Timeline({ title, rows }: { title: string; rows: { month: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <section className="arr-section">
    <div className="arr-section-heading"><div><h2>{title}</h2><p>Last 12 months · {total.toLocaleString()} added</p></div></div>
    {rows.length === 0 ? <p className="arr-empty">No activity yet.</p> : <div className="arr-timeline-scroll">
      <div className="arr-timeline">{rows.map(row => {
        const date = new Date(row.month + '-01T12:00:00');
        const month = date.toLocaleDateString(undefined, { month: 'short' });
        const full = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        return <div key={row.month} className="arr-timeline-column" aria-label={`${full}: ${row.count} added`}>
          <div className="arr-timeline-track"><div className="arr-timeline-bar" style={{ height: `${row.count / max * 100}%` }}>
            <span>{row.count}</span>
          </div></div>
          <span className="arr-timeline-month" title={full}>{month}</span>
        </div>;
      })}</div>
    </div>}
  </section>;
}

export function RootFolders({ rows, itemLabel }: { rows: { path: string; count: number; size: number }[]; itemLabel: string }) {
  return <section className="arr-section">
    <div className="arr-section-heading"><div><h2>Root folders</h2><p>Library files managed by this service</p></div></div>
    {rows.length === 0 ? <p className="arr-empty">No root folders in the library yet.</p> : <div className="arr-table-scroll"><table className="arr-table">
      <thead><tr><th scope="col">Path</th><th scope="col">{itemLabel}</th><th scope="col">Library size</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.path}><th scope="row" className="arr-path-cell">{row.path}</th><td>{row.count.toLocaleString()}</td><td>{formatBytes(row.size)}</td></tr>)}</tbody>
    </table></div>}
  </section>;
}

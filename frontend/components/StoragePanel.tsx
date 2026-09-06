import React, { useEffect, useId, useRef, useState } from 'react';
import { formatBytes, GIB, normalisePath, updateQuotaDraft } from '../storage';

export interface StorageDisk {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
  usedSpace: number;
  usedPercent: number;
  quotaBytes: number | null;
}

function StorageIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 13h18M7 16h.01M11 16h.01" />
  </svg>;
}

export function StoragePanel({ disks, base, service, onSaved }: {
  disks: StorageDisk[]; base: string; service: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) restoreFocus.current = true;
    else if (restoreFocus.current) trigger.current?.focus();
  }, [editing]);
  const configured = disks.filter(d => d.quotaBytes !== null).length;
  return <section className="arr-section arr-storage" aria-label="Storage">
    <div className="arr-section-heading">
      <div className="arr-heading-with-icon">
        <span className="arr-section-icon"><StorageIcon /></span>
        <div><h2>Storage</h2><p>Filesystem space reported by {service}</p></div>
      </div>
      <button ref={trigger} type="button" className="arr-button arr-button-primary" onClick={() => { setSaved(false); setEditing(true); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
        </svg>
        Storage limits{configured > 0 && <span className="arr-button-count">{configured}</span>}
      </button>
    </div>
    {saved && <p className="arr-feedback arr-success" role="status">Storage limits saved.</p>}
    {disks.length === 0 ? <p className="arr-empty">{service} has not reported any disks yet. You can still manage saved limits.</p> :
      <div className="arr-disk-grid">{disks.map(disk => {
        const percent = Math.max(0, Math.min(100, disk.usedPercent));
        const tone = percent > 90 ? 'danger' : percent > 70 ? 'warning' : 'normal';
        return <article className="arr-disk" key={disk.path}>
          <div className="arr-disk-heading">
            <div className="arr-disk-path"><h3>{disk.label || disk.path}</h3>{disk.label && disk.label !== disk.path && <p>{disk.path}</p>}</div>
            <span className={'arr-badge arr-badge-' + tone}>{percent}% used</span>
          </div>
          <div className="arr-space-value"><strong>{formatBytes(disk.freeSpace)}</strong><span>free on filesystem</span></div>
          <div className={'arr-meter arr-meter-' + tone} role="meter" aria-label={`Filesystem usage for ${disk.path}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="arr-disk-amounts"><span>{formatBytes(disk.usedSpace)} used</span><span>{formatBytes(disk.totalSpace)} total</span></div>
          <div className="arr-limit-summary">
            <span>Declared limit</span><strong>{disk.quotaBytes === null ? 'Not set' : formatBytes(disk.quotaBytes)}</strong>
          </div>
          {disk.quotaBytes !== null && <p className="arr-quota-note">Remaining quota: unavailable</p>}
        </article>;
      })}</div>}
    <p className="arr-storage-note">Linux user and group quotas may reduce the space available to your account. {service} does not report their usage; a declared limit is a reference and does not enforce a quota.</p>
    {editing && <StorageEditor disks={disks} base={base} service={service}
      onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setSaved(true); onSaved(); }} />}
  </section>;
}

function StorageEditor({ disks, base, service, onClose, onSaved }: {
  disks: StorageDisk[]; base: string; service: string; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [initial, setInitial] = useState<Record<string, number> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current!;
    element.showModal();
    return () => { mounted.current = false; element.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch(`${base}/quotas`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Could not load saved limits (HTTP ${response.status}).`);
        return response.json();
      })
      .then(({ quotas }: { quotas: Record<string, number> }) => {
        if (controller.signal.aborted) return;
        setInitial(quotas);
        const values = new Map<string, string>();
        for (const disk of disks) values.set(normalisePath(disk.path), '');
        for (const [path, bytes] of Object.entries(quotas)) values.set(normalisePath(path), String(bytes / GIB));
        setDraft(Object.fromEntries(values));
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, retry]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!initial || requestInFlight.current) return;
    setError(null);
    let quotas: Record<string, number>;
    try { quotas = updateQuotaDraft(initial, draft); }
    catch (err) { setError((err as Error).message); return; }
    requestInFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch(`${base}/quotas`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotas }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Could not save limits (HTTP ${response.status}).`);
      if (mounted.current) onSaved();
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <dialog ref={dialog} className="arr-dialog" aria-labelledby={id + '-title'} aria-describedby={id + '-description'}
    onCancel={event => { event.preventDefault(); if (!requestInFlight.current) onClose(); }}>
    <form onSubmit={save} className="arr-dialog-form">
      <header className="arr-dialog-heading">
        <div><span className="arr-eyebrow">{service} · Storage</span><h2 id={id + '-title'}>Storage limits</h2></div>
        <button type="button" className="arr-icon-button" aria-label="Close storage limits" disabled={saving} onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="arr-dialog-body">
        <p id={id + '-description'}>Record the quota configured on your server for each path. Leave a field blank to remove its declared limit.</p>
        <div className="arr-info">These values are for reference. {service} cannot read Linux user quota usage, so remaining quota cannot be calculated.</div>
        {!initial && !error && <p role="status" className="arr-empty">Loading saved limits…</p>}
        {initial && <fieldset disabled={saving} className="arr-limit-fields">
          <legend className="arr-sr-only">Limits in GiB</legend>
          {Object.entries(draft).map(([path, value], index) => {
            const disk = disks.find(d => normalisePath(d.path) === path);
            return <div className="arr-limit-field" key={path}>
              <label htmlFor={id + '-' + index}>
                <strong>{disk?.label || path}</strong>
                {disk?.label && disk.label !== path && <span>{path}</span>}
                <span>{disk ? `${formatBytes(disk.freeSpace)} free on filesystem` : `Not currently reported by ${service}`}</span>
              </label>
              <div className="arr-unit-input">
                <input id={id + '-' + index} type="text" inputMode="decimal" value={value} placeholder="No limit"
                  aria-label={`Storage limit for ${path} in GiB`}
                  onChange={event => setDraft(current => ({ ...current, [path]: event.target.value }))} />
                <span aria-hidden="true">GiB</span>
              </div>
            </div>;
          })}
          {Object.keys(draft).length === 0 && <p className="arr-empty">No storage paths available.</p>}
        </fieldset>}
        <p className="arr-unit-help">1 TiB = 1,024 GiB. Decimal values are accepted (for example, 500.5).</p>
        {error && <div className="arr-feedback arr-error" role="alert">{error}{!initial &&
          <button type="button" className="arr-button" onClick={() => setRetry(n => n + 1)}>Retry</button>}</div>}
      </div>
      <footer className="arr-dialog-footer">
        <button type="button" className="arr-button" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="arr-button arr-button-primary" disabled={saving || !initial || Object.keys(draft).length === 0}>
          {saving ? 'Saving…' : 'Save limits'}
        </button>
      </footer>
    </form>
  </dialog>;
}

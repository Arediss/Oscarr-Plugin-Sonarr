/**
 * Manual storage limits are reference values. The arr disk-space endpoint reports
 * filesystem usage, not usage charged to a Linux user/group quota.
 */
export interface DiskEntry {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface DiskView extends DiskEntry {
  usedSpace: number;
  usedPercent: number;
  quotaBytes: number | null;
  /** Unknown for a declared quota: its usage is not available from the arr API. */
  effectiveFree: number | null;
  quotaLimited: boolean | null;
}

export function normalise(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

export function parseQuotas(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([path, value]) => {
      const bytes = Number(value);
      return Number.isSafeInteger(bytes) && bytes > 0 ? [[normalise(path), bytes]] : [];
    }));
  } catch {
    return {};
  }
}

/** Reject invalid writes as a whole instead of silently removing existing limits. */
export function serialiseQuotas(quotas: Record<string, unknown>): string {
  const entries = Object.entries(quotas).map(([path, bytes]) => {
    if (!path.trim() || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Each storage limit must be a non-negative whole number of bytes keyed by a path.');
    }
    return [normalise(path), bytes] as const;
  });
  return JSON.stringify(Object.fromEntries(entries.filter(([, bytes]) => bytes > 0)));
}

export function applyQuotas(disks: DiskEntry[], quotas: Record<string, number>): DiskView[] {
  const byPath = new Map(Object.entries(quotas).map(([path, bytes]) => [normalise(path), bytes]));
  return disks.map((disk) => {
    const totalSpace = Number.isFinite(disk.totalSpace) ? Math.max(0, disk.totalSpace) : 0;
    const freeSpace = Number.isFinite(disk.freeSpace) ? Math.max(0, Math.min(disk.freeSpace, totalSpace)) : 0;
    const usedSpace = totalSpace - freeSpace;
    const quotaBytes = byPath.get(normalise(disk.path)) ?? null;
    return {
      ...disk, totalSpace, freeSpace, usedSpace,
      usedPercent: totalSpace > 0 ? Math.round(usedSpace / totalSpace * 100) : 0,
      quotaBytes,
      // Never subtract filesystem usage (which includes other users) from a user quota.
      effectiveFree: quotaBytes === null ? freeSpace : null,
      quotaLimited: quotaBytes === null ? false : null,
    };
  });
}

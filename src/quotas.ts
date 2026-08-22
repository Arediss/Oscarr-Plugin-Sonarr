/**
 * Admin-declared storage caps, per root folder.
 *
 * Radarr and Sonarr report what `statfs` says about the filesystem, which is the truth unless a
 * quota sits between the account and the disk. Project quotas (XFS) and dataset quotas (ZFS) are
 * already reflected there; *user* and *group* quotas are not — `df` shows the whole filesystem and
 * the operator hits a wall long before it fills.
 *
 * Reading the real quota would mean running `quota` as the owning user on the host that holds the
 * media. Oscarr runs in its own container, without the library mounted and without those tools, so
 * anything it measured would describe its own volume. Rather than print a confident wrong number,
 * the admin declares the cap and we do the arithmetic.
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
  /** Declared cap in bytes, or null when the admin has not set one for this path. */
  quotaBytes: number | null;
  /** What is actually writable: the filesystem's free space, or what the cap leaves. */
  effectiveFree: number;
  /** True when the cap, not the disk, is the binding constraint. */
  quotaLimited: boolean;
}

/** Trailing slashes differ between what an *arr reports and what an admin types. */
function normalise(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

export function parseQuotas(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      const bytes = Number(value);
      // 0 and negatives mean "no cap" — treat them as absent rather than as a full disk.
      if (Number.isFinite(bytes) && bytes > 0) out[normalise(path)] = Math.floor(bytes);
    }
    return out;
  } catch {
    return {};
  }
}

export function serialiseQuotas(quotas: Record<string, number>): string {
  const clean: Record<string, number> = {};
  for (const [path, bytes] of Object.entries(quotas)) {
    const n = Number(bytes);
    if (Number.isFinite(n) && n > 0) clean[normalise(path)] = Math.floor(n);
  }
  return JSON.stringify(clean);
}

/**
 * A cap smaller than what is already used leaves nothing writable, not a negative number — that
 * is the state an operator is actually in when they blow past a quota.
 */
export function applyQuotas(disks: DiskEntry[], quotas: Record<string, number>): DiskView[] {
  // Normalised on both sides rather than trusting the caller to have gone through parseQuotas —
  // a raw map used to silently match nothing, which reads as "no quota" instead of as a mistake.
  const byPath = new Map<string, number>();
  for (const [path, bytes] of Object.entries(quotas)) byPath.set(normalise(path), bytes);

  return disks.map((d) => {
    const usedSpace = d.totalSpace - d.freeSpace;
    const quotaBytes = byPath.get(normalise(d.path)) ?? null;
    const quotaFree = quotaBytes === null ? null : Math.max(0, quotaBytes - usedSpace);
    const effectiveFree = quotaFree === null ? d.freeSpace : Math.min(d.freeSpace, quotaFree);
    return {
      ...d,
      usedSpace,
      usedPercent: d.totalSpace > 0 ? Math.round((usedSpace / d.totalSpace) * 100) : 0,
      quotaBytes,
      effectiveFree,
      quotaLimited: quotaFree !== null && quotaFree < d.freeSpace,
    };
  });
}

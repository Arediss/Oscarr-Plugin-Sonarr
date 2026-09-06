export const GIB = 1024 ** 3;
export const normalisePath = (path: string) => path.replace(/\/+$/, '') || '/';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))), units.length - 1);
  return `${(bytes / 1024 ** i).toLocaleString(undefined, { maximumFractionDigits: i >= 4 ? 2 : 1 })} ${units[i]}`;
}

/** Keep untouched byte values exact, including limits for temporarily unavailable paths. */
export function updateQuotaDraft(saved: Record<string, number>, draft: Record<string, string>): Record<string, number> {
  const result = new Map(Object.entries(saved).map(([path, bytes]) => [normalisePath(path), bytes]));
  for (const [path, raw] of Object.entries(draft)) {
    const key = normalisePath(path);
    if (raw === (result.has(key) ? String(result.get(key)! / GIB) : '')) continue;
    const value = raw.trim();
    if (!value || Number(value) === 0) {
      result.delete(key);
      continue;
    }
    const gib = Number(value);
    const bytes = Math.round(gib * GIB);
    if (!Number.isFinite(gib) || gib < 0 || !Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new Error(`Enter a positive limit in GiB for ${path}, or leave it blank to remove the limit.`);
    }
    result.set(key, bytes);
  }
  return Object.fromEntries(result);
}

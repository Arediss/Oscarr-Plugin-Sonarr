import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyQuotas, parseQuotas, serialiseQuotas } from '../src/quotas';
import { formatBytes, GIB, updateQuotaDraft } from '../frontend/storage';
import { analyticsRoutes } from '../src/routes/analytics';

test('a shared filesystem cannot reveal remaining user quota', () => {
  const [disk] = applyQuotas([{ path: '/media/', label: '', totalSpace: 52400 * GIB, freeSpace: 1000 * GIB }], { '/media': 500 * GIB });
  assert.equal(disk.usedPercent, 98);
  assert.equal(disk.freeSpace, 1000 * GIB);
  assert.equal(disk.quotaBytes, 500 * GIB);
  assert.equal(disk.effectiveFree, null);
  assert.equal(disk.quotaLimited, null);
});

test('without a declared limit, preserve the physical disk figures', () => {
  const [disk] = applyQuotas([{ path: '/', label: '', totalSpace: 100 * GIB, freeSpace: 71 * GIB }], {});
  assert.equal(disk.usedPercent, 29);
  assert.equal(disk.effectiveFree, 71 * GIB);
  assert.equal(disk.quotaLimited, false);
});

test('invalid disk figures never yield NaN or an out-of-range bar', () => {
  for (const [totalSpace, freeSpace] of [[0, 0], [-1, 100], [100, 200], [100, -1], [NaN, Infinity]]) {
    const [disk] = applyQuotas([{ path: '/', label: '', totalSpace, freeSpace }], {});
    assert.ok(Number.isFinite(disk.usedPercent) && disk.usedPercent >= 0 && disk.usedPercent <= 100);
    assert.ok(disk.usedSpace >= 0 && disk.freeSpace >= 0);
  }
});

test('read legacy limits and normalize paths, including the filesystem root', () => {
  assert.deepEqual(parseQuotas('{"/media/":"12345","/":6789,"/empty":0,"/bad":-1}'), { '/media': 12345, '/': 6789 });
  for (const raw of ['', '[1]', 'null', 'garbage']) assert.deepEqual(parseQuotas(raw), {});
});

test('reject an invalid update instead of silently dropping limits', () => {
  for (const value of [-1, 0.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, true]) {
    assert.throws(() => serialiseQuotas({ '/good': 100, '/bad': value }));
  }
  assert.throws(() => serialiseQuotas({ ' ': 100 }));
});

test('clear limits with zero and round-trip valid byte values', () => {
  assert.deepEqual(parseQuotas(serialiseQuotas({ '/media/': 500.5 * GIB, '/remove': 0 })), { '/media': 500.5 * GIB });
});

test('editing another field preserves fractional limits and unavailable paths exactly', () => {
  const saved = { '/media': 1234567890123, '/offline': 987654321 };
  const result = updateQuotaDraft(saved, { '/media': String(saved['/media'] / GIB), '/new': '500.5' });
  assert.deepEqual(result, { ...saved, '/new': 500.5 * GIB });
});

test('remove only the requested limit and normalize paths', () => {
  assert.deepEqual(updateQuotaDraft({ '/keep': 100, '/remove': 200 }, { '/remove/': '', '/new/': '2' }), { '/keep': 100, '/new': 2 * GIB });
  assert.deepEqual(updateQuotaDraft({ '/remove': 200 }, { '/remove': '0' }), {});
});

test('reject invalid GiB values before any request is sent', () => {
  for (const value of ['-5', 'abc', 'Infinity', '1e100', '0.00000000001']) {
    assert.throws(() => updateQuotaDraft({ '/media': 123 }, { '/media': value }));
  }
});

test('use accurate binary unit labels', () => {
  assert.equal(formatBytes(GIB), '1 GiB');
  assert.equal(formatBytes(1024 * GIB), '1 TiB');
  assert.equal(formatBytes(0), '0 B');
});

function routes(initial = '{"/offline":12345}') {
  let stored = initial;
  const handlers = new Map<string, Function>();
  const app = Object.fromEntries(['get', 'put', 'post'].map(method => [method, (path: string, handler: Function) => handlers.set(method + ' ' + path, handler)]));
  analyticsRoutes(app as any, {
    getSetting: async () => stored,
    setSetting: async (_key, value) => { stored = value as string; },
  });
  return {
    stored: () => stored,
    async call(method: string, path: string, body?: unknown, api?: unknown) {
      let status = 200;
      const reply = { status: (code: number) => { status = code; return reply; }, send: (value: unknown) => value };
      const result = await handlers.get(method + ' ' + path)!({ body, radarrApi: api, sonarrApi: api }, reply);
      return { status, result };
    },
  };
}

test('quota route refuses malformed updates without touching saved settings', async () => {
  const api = routes();
  for (const quotas of [null, [], { '/bad': -1 }, { '/bad': '100' }, { '/ok': 123, '/bad': 0.5 }]) {
    const response = await api.call('put', '/quotas', { quotas });
    assert.equal(response.status, 400);
    assert.equal(api.stored(), '{"/offline":12345}');
  }
});

test('saved decimal limits are returned by GET and refreshed analytics', async () => {
  const api = routes();
  const quotas = { '/media': 500.5 * GIB, '/offline': 12345 };
  assert.equal((await api.call('put', '/quotas', { quotas })).status, 200);
  assert.deepEqual((await api.call('get', '/quotas')).result, { quotas });
  const analytics = await api.call('get', '/analytics', undefined, {
    getMovies: async () => [], getAllSeries: async () => [], getQualityProfiles: async () => [],
    getDiskSpace: async () => [{ path: '/media', label: '', totalSpace: 52400 * GIB, freeSpace: 1000 * GIB }],
  });
  assert.equal(analytics.result.diskSpace[0].quotaBytes, 500.5 * GIB);
  assert.equal(analytics.result.diskSpace[0].effectiveFree, null);
});

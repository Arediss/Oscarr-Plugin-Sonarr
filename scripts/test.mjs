import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'oscarr-storage-tests-'));
try {
  const outfile = join(directory, 'storage.test.mjs');
  await build({ entryPoints: ['tests/storage.test.ts'], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20' });
  const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

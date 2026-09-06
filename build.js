import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules, createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  'fastify',
];

// ── Backend bundle ───────────────────────────────────────────────────
await build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  outfile: resolve(__dirname, 'dist/index.js'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  minify: false,
  sourcemap: true,
  external: nodeExternals,
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});
console.log('Backend built → dist/index.js');

// ── Frontend page and dashboard widget bundles ──────────────────────
await build({
  entryPoints: [
    resolve(__dirname, 'frontend/index.tsx'),
    resolve(__dirname, 'frontend/hooks/admin.dashboard.widget.tsx'),
  ],
  outbase: resolve(__dirname, 'frontend'),
  outdir: resolve(__dirname, 'dist/frontend'),
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  bundle: true,
  minify: false,
  sourcemap: true,
  jsx: 'automatic',
  jsxImportSource: 'react',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  logLevel: 'info',
});
console.log('Frontend built → dist/frontend/index.js');

// ── Tailwind CSS step (added by add-tailwind-to-plugin.mjs) ─────────────────
import { spawn, spawnSync } from 'child_process';

const twWatch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);
const tailwindCli = require.resolve('tailwindcss/lib/cli.js');
const tailwindArgs = [
  '-c', resolve(__dirname, 'tailwind.config.js'),
  '-i', resolve(__dirname, 'frontend/index.css'),
  '-o', resolve(__dirname, 'dist/frontend/index.css'),
  ...(twWatch ? ['--watch'] : ['--minify']),
];

if (twWatch) {
  // Fire-and-forget in watch mode; the CLI's own watcher owns the lifecycle.
  const twChild = spawn(process.execPath, [tailwindCli, ...tailwindArgs], { stdio: 'inherit', cwd: __dirname });
  twChild.on('error', (error) => { console.error(error); process.exit(1); });
  twChild.on('exit', (code) => { if (code !== null && code !== 0) process.exit(code); });
} else {
  const twResult = spawnSync(process.execPath, [tailwindCli, ...tailwindArgs], { stdio: 'inherit', cwd: __dirname });
  if (twResult.status !== 0) process.exit(twResult.status || 1);
  console.log('Frontend (CSS) built → dist/frontend/index.css');
}

// Builds @cas/shared into plain ESM under dist/ so Node/tsx/Next can load the
// workspace package at runtime without TS transforms. zod is bundled in so
// consumers never need to resolve it themselves.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

const entries = {
  index: 'src/index.ts',
  providers: 'src/providers.ts',
  registry: 'src/registry.ts',
  formats: 'src/formats.ts',
};

mkdirSync('dist', { recursive: true });

for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [entry],
    outfile: `dist/${name}.js`,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'warning',
  });
}
console.log('shared build done → dist/*.js');

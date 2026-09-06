import 'dotenv/config';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8787),
  // DB: leave unset for embedded SQLite (demo/dev). Set a postgres:// URL for Postgres.
  DATABASE_URL: z.string().optional(),
  // Queue: leave unset for the in-process queue. Set redis:// URL for BullMQ + Redis.
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  // Master key for the AES-256-GCM secrets store. Auto-generated (and persisted
  // to data/) on first boot when unset — for local dev only.
  CAS_MASTER_KEY: z.string().optional(),
  CAS_ROUTING_STRATEGY: z.enum(['priority', 'capability', 'load']).default('priority'),
  CAS_FFMPEG_PATH: z.string().optional(),
  CAS_SEED_DEMO: z.enum(['true', 'false']).default('true'),
  CAS_ENABLE_MOCK: z.enum(['true', 'false']).default('true'),
  CAS_ALLOW_DEMO_AUTH: z.enum(['true', 'false']).default('true'),
  // Outbound calls to AI providers are real only when a key is present. When no
  // keys are configured at all, generation degrades to the bundled mock so the
  // whole pipeline stays demoable — surfaced honestly in the UI.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const API_ROOT = path.resolve(import.meta.dirname, '..'); // apps/api
export const paths = {
  apiRoot: API_ROOT,
  dataDir: path.join(API_ROOT, 'data'),
  objectsDir: path.join(API_ROOT, 'data', 'objects'),
  tmpDir: path.join(API_ROOT, 'data', 'tmp'),
  dbFile: path.join(API_ROOT, 'data', 'cas.sqlite'),
  masterKeyFile: path.join(API_ROOT, 'data', 'secrets', 'master.key'),
};

for (const dir of [paths.dataDir, paths.objectsDir, paths.tmpDir, path.dirname(paths.masterKeyFile)]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const config = {
  ...env,
  isDev: env.NODE_ENV !== 'production',
  apiRoot: API_ROOT,
  paths,
  demoMode: env.CAS_ALLOW_DEMO_AUTH === 'true',
  allowMock: env.CAS_ENABLE_MOCK === 'true',
  seedDemo: env.CAS_SEED_DEMO === 'true',
};

export type Config = typeof config;

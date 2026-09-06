import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config';
import { logger } from './logger';
import { makeId } from './util';

// ---------------------------------------------------------------------------
// Object storage abstraction.
//
// Demo/dev: local filesystem under data/objects (served back through authed
// API endpoints, never as raw public URLs). Production: swap in an S3/R2
// driver implementing the same interface and set CAS_STORAGE=s3 with
// S3_* env vars. Asset keys are stored on asset_versions.object_key.
// ---------------------------------------------------------------------------

export interface ObjectStore {
  put(key: string, data: Buffer, contentType: string): void;
  get(key: string): Buffer | null;
  exists(key: string): boolean;
  delete(key: string): void;
  localPath(key: string): string; // for ffmpeg pipelines
}

class LocalStore implements ObjectStore {
  private file(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._/-]/g, '_');
    const abs = path.join(paths.objectsDir, safe);
    if (!abs.startsWith(paths.objectsDir)) throw new Error('invalid key');
    return abs;
  }
  put(key: string, data: Buffer, _contentType: string): void {
    const f = this.file(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
  get(key: string): Buffer | null {
    const f = this.file(key);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  exists(key: string): boolean {
    return fs.existsSync(this.file(key));
  }
  delete(key: string): void {
    fs.rmSync(this.file(key), { force: true });
  }
  localPath(key: string): string {
    return this.file(key);
  }
}

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
  if (!store) {
    if (config.NODE_ENV === 'production') {
      logger.warn('Production storage: only local filesystem driver wired for now. Configure S3/R2 driver (see storage.ts).');
    }
    store = new LocalStore();
  }
  return store;
}

export function newObjectKey(ext: string): string {
  const yyyymm = new Date().toISOString().slice(0, 7);
  return `assets/${yyyymm}/${makeId('obj')}.${ext}`;
}

export async function bufferFromPath(p: string): Promise<Buffer | null> {
  try {
    return await fs.promises.readFile(p);
  } catch {
    return null;
  }
}

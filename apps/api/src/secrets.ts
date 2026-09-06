import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Encrypted secrets store (AES-256-GCM).
//
// Nothing sensitive is ever hardcoded or stored in plain text on disk:
//  - AI provider API keys
//  - Platform OAuth client secrets + access/refresh tokens
// are encrypted with a master key (env CAS_MASTER_KEY in prod; auto-generated
// and stored 0600 in data/secrets/master.key for local dev) before persisting.
// In memory they're held as plaintext only inside this module.
// ---------------------------------------------------------------------------

export type SecretKind = 'provider-key' | 'platform-oauth' | 'platform-token' | 'platform-refresh';

export interface SecretRef {
  kind: SecretKind;
  name: string; // provider id or `platform:client` / `platform:user:<id>`
}

function getMasterKey(): Buffer {
  if (config.CAS_MASTER_KEY) return Buffer.from(config.CAS_MASTER_KEY, 'utf8').subarray(0, 32);
  if (fs.existsSync(paths.masterKeyFile)) {
    return fs.readFileSync(paths.masterKeyFile);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(paths.masterKeyFile, key, { mode: 0o600 });
  logger.info('Generated dev master key for secrets store.');
  return key;
}

let masterKeyCache: Buffer | null = null;
function masterKey(): Buffer {
  if (!masterKeyCache) masterKeyCache = getMasterKey();
  return masterKeyCache;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(envelope: string): string {
  if (!envelope.startsWith('enc:v1:')) throw new Error('Unsupported secret envelope');
  const [, , ivB64, tagB64, dataB64] = envelope.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---- tiny table-of-records store: <kind>/<name> -> envelope ----------------
const RECORD_DIR = () => `${paths.dataDir}/secrets/records`;

function recordFile(ref: SecretRef): string {
  const safe = ref.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${RECORD_DIR()}/${ref.kind}/${safe}.enc`;
}

export const secretStore = {
  set(ref: SecretRef, plain: string): void {
    const file = recordFile(ref);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encryptSecret(plain), { mode: 0o600 });
  },
  get(ref: SecretRef): string | null {
    const file = recordFile(ref);
    if (!fs.existsSync(file)) return null;
    try {
      return decryptSecret(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      logger.error(`Failed to decrypt secret ${ref.kind}/${ref.name}`, e);
      return null;
    }
  },
  has(ref: SecretRef): boolean {
    return fs.existsSync(recordFile(ref));
  },
  delete(ref: SecretRef): void {
    fs.rmSync(recordFile(ref), { force: true });
  },
};

export function secretRefForProvider(providerId: string): SecretRef {
  return { kind: 'provider-key', name: providerId };
}

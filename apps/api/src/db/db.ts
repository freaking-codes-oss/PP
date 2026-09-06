import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import { logger } from '../logger';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

// ---------------------------------------------------------------------------
// Data access layer.
//
// Driver: better-sqlite3 — a synchronous, prebuilt SQLite driver that works on
// Node 20+ (unlike node:sqlite, which is experimental and only exists on
// Node >= 22.5). All ids are TEXT, timestamps ISO TEXT, JSON payloads stored
// as text.
//
// NOTE ON POSTGRESQL: this build deliberately uses a synchronous DAL so the
// demo runs with no infrastructure. For a production deployment the same
// repositories/queries run against PostgreSQL by promoting this layer to an
// async DAL (queries are already written in a portable subset: no SQLite-only
// features are used — see schema.ts). Set DATABASE_URL when that driver lands.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, params?: unknown[]): T[];
  get<T = Row>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): { changes: number };
  exec(sql: string): void;
  close(): void;
}

function createSqlite(dbFile: string): Db {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return {
    all<T = Row>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
      return db.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    run(sql: string, params: unknown[] = []) {
      const res = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(res.changes) };
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}

let db: Db | null = null;

export async function initDb(): Promise<Db> {
  if (db) return db;
  if (config.DATABASE_URL) {
    logger.warn('DATABASE_URL set but this build runs an embedded-SQLite DAL. Postgres driver: see src/db/db.ts — using SQLite for now.');
  }
  logger.info(`Using embedded SQLite at ${config.paths.dbFile}`);
  db = createSqlite(config.paths.dbFile);
  db.exec(SCHEMA_SQL);
  const meta = db.get('SELECT value FROM schema_meta WHERE key = ?', ['schema_version']);
  if (!meta) {
    db.run("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
    logger.info(`Database schema initialized (v${SCHEMA_VERSION}).`);
  }
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized — call initDb() first');
  return db;
}

export type { Row };

import { Modality } from '@cas/shared';
import { BUILTIN_PROVIDER_REGISTRY } from '@cas/shared/registry';
import { getDb } from '../db/db';
import { j, pj } from '../db/repos';
import { logger } from '../logger';

export interface ProviderConfigRow {
  id: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_method: string;
  api_shape: string;
  auth_header: string | null;
  modalities: string; // JSON
  rate_limit: string | null;
  free_tier: number;
  enabled: number;
  priority: number;
  enabled_modalities: string | null;
  models: string; // JSON
  updated_at: string;
}

export const providerConfigRepo = {
  // Sync DB rows from the built-in registry — new providers appear, local
  // enabled/priority overrides are kept.
  syncRegistry(): void {
    const db = getDb();
    for (const p of BUILTIN_PROVIDER_REGISTRY) {
      const existing = db.get('SELECT * FROM provider_configs WHERE id = ?', [p.id]) as ProviderConfigRow | undefined;
      const models = j(p.models);
      const modalities = j(p.supportedModalities);
      const rateLimit = p.rateLimit ? j(p.rateLimit) : null;
      if (existing) {
        db.run(
          `UPDATE provider_configs SET name=?, description=?, base_url=?, auth_method=?, api_shape=?, auth_header=?,
             modalities=?, rate_limit=?, models=?, updated_at=? WHERE id=?`,
          [p.name, p.description ?? null, p.baseUrl, p.authMethod, p.apiShape, p.authHeader ?? null,
            modalities, rateLimit, models, new Date().toISOString(), p.id],
        );
      } else {
        db.run(
          `INSERT INTO provider_configs (id, name, description, base_url, auth_method, api_shape, auth_header,
             modalities, rate_limit, free_tier, enabled, priority, enabled_modalities, models, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [p.id, p.name, p.description ?? null, p.baseUrl, p.authMethod, p.apiShape, p.authHeader ?? null,
            modalities, rateLimit, p.freeTier ? 1 : 0, p.id === 'mock' ? 1 : 0, 10, null, models, new Date().toISOString()],
        );
      }
    }
    logger.info('Synced AI provider registry into DB.');
  },
  all(): ProviderConfigRow[] {
    return getDb().all('SELECT * FROM provider_configs ORDER BY priority ASC, name ASC') as ProviderConfigRow[];
  },
  byId(id: string): ProviderConfigRow | undefined {
    return getDb().get('SELECT * FROM provider_configs WHERE id = ?', [id]) as ProviderConfigRow | undefined;
  },
  update(id: string, patch: { enabled?: boolean; priority?: number; enabled_modalities?: Modality[] }): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0); }
    if (patch.priority !== undefined) { sets.push('priority = ?'); params.push(patch.priority); }
    if (patch.enabled_modalities !== undefined) {
      sets.push('enabled_modalities = ?');
      params.push(j(patch.enabled_modalities));
    }
    if (!sets.length) return;
    params.push(new Date().toISOString(), id);
    getDb().run(`UPDATE provider_configs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params);
  },
  modalitiesOf(p: ProviderConfigRow): Modality[] {
    const base = pj<Modality[]>(p.modalities);
    if (p.enabled_modalities) {
      const subset = pj<Modality[]>(p.enabled_modalities);
      return base.filter((m) => subset.includes(m));
    }
    return base;
  },
};

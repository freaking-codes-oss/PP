import { AssetType, PipelineStage, PlatformId } from '@cas/shared';
import { getDb } from './db';
import { nowIso, makeId } from '../util';

type Row = Record<string, unknown>;
type Params = unknown[];

// --- tiny helpers -----------------------------------------------------------
export const j = JSON.stringify;
export const pj = <T>(v: unknown): T => (v == null ? (null as T) : (JSON.parse(String(v)) as T));

// --- users ------------------------------------------------------------------
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export const userRepo = {
  findByEmail(email: string): UserRow | undefined {
    return getDb().get('SELECT * FROM users WHERE email = ?', [email]) as UserRow | undefined;
  },
  findById(id: string): UserRow | undefined {
    return getDb().get('SELECT * FROM users WHERE id = ?', [id]) as UserRow | undefined;
  },
  create(u: { id: string; email: string; password_hash: string; name: string }): void {
    const t = nowIso();
    getDb().run('INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?,?,?,?,?,?)', [
      u.id, u.email, u.password_hash, u.name, t, t,
    ]);
  },
};

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  idea: string | null;
  current_stage: string;
  style_preset_id: string | null;
  video_mode: string;
  created_at: string;
  updated_at: string;
}

export const projectRepo = {
  listForUser(userId: string): ProjectRow[] {
    return getDb()
      .all('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', [userId])
      .map((r) => r as unknown as ProjectRow);
  },
  find(id: string, userId: string): ProjectRow | undefined {
    return getDb().get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, userId]) as
      | ProjectRow
      | undefined;
  },
  create(p: { id: string; userId: string; name: string; idea?: unknown; stylePresetId?: string }): void {
    const t = nowIso();
    getDb().run(
      `INSERT INTO projects (id, user_id, name, idea, current_stage, style_preset_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [p.id, p.userId, p.name, p.idea ? j(p.idea) : null, PipelineStage.IDEATION, p.stylePresetId ?? 'preset_studio-teal', t, t],
    );
  },
  update(id: string, patch: { name?: string; current_stage?: PipelineStage; idea?: unknown; style_preset_id?: string | null; video_mode?: string }): void {
    const sets: string[] = [];
    const params: Params = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.current_stage !== undefined) { sets.push('current_stage = ?'); params.push(patch.current_stage); }
    if (patch.idea !== undefined) { sets.push('idea = ?'); params.push(patch.idea === null ? null : j(patch.idea)); }
    if (patch.style_preset_id !== undefined) { sets.push('style_preset_id = ?'); params.push(patch.style_preset_id); }
    if (patch.video_mode !== undefined) { sets.push('video_mode = ?'); params.push(patch.video_mode); }
    if (!sets.length) return;
    params.push(nowIso(), id);
    getDb().run(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params);
  },
  delete(id: string): void {
    getDb().run('DELETE FROM projects WHERE id = ?', [id]);
  },
  touch(id: string): void {
    getDb().run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowIso(), id]);
  },
};

export type StageState = 'not_started' | 'running' | 'ready' | 'error' | 'blocked';
export interface StageRow {
  project_id: string;
  stage: string;
  state: string;
  progress: number;
  status_text: string | null;
  updated_at: string;
}

export const stageRepo = {
  upsert(projectId: string, stage: PipelineStage, patch: Partial<{ state: StageState; progress: number; status_text: string }>): void {
    const existing = getDb().get('SELECT project_id FROM project_stages WHERE project_id = ? AND stage = ?', [projectId, stage]);
    const state = patch.state ?? 'running';
    const progress = patch.progress ?? 0;
    const statusText = patch.status_text ?? null;
    if (existing) {
      getDb().run('UPDATE project_stages SET state=?, progress=?, status_text=?, updated_at=? WHERE project_id=? AND stage=?', [
        state, progress, statusText, nowIso(), projectId, stage,
      ]);
    } else {
      getDb().run('INSERT INTO project_stages (project_id, stage, state, progress, status_text, updated_at) VALUES (?,?,?,?,?,?)', [
        projectId, stage, state, progress, statusText, nowIso(),
      ]);
    }
  },
  forProject(projectId: string): StageRow[] {
    return getDb().all('SELECT * FROM project_stages WHERE project_id = ?', [projectId]) as StageRow[];
  },
};

export interface ScriptVersionRow {
  id: string;
  project_id: string;
  version: number;
  source: string;
  prompt: string | null;
  provider: string | null;
  script: string; // JSON
  created_at: string;
}

export const scriptRepo = {
  latest(projectId: string): ScriptVersionRow | undefined {
    return getDb().get('SELECT * FROM script_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId]) as
      | ScriptVersionRow
      | undefined;
  },
  list(projectId: string): ScriptVersionRow[] {
    return getDb().all('SELECT * FROM script_versions WHERE project_id = ? ORDER BY version DESC', [projectId]) as ScriptVersionRow[];
  },
  insert(v: { id: string; projectId: string; version: number; source: string; prompt?: string | null; provider?: string | null; script: unknown }): void {
    getDb().run('INSERT INTO script_versions (id, project_id, version, source, prompt, provider, script, created_at) VALUES (?,?,?,?,?,?,?,?)', [
      v.id, v.projectId, v.version, v.source, v.prompt ?? null, v.provider ?? null, j(v.script), nowIso(),
    ]);
  },
};

export interface AssetRow {
  id: string;
  project_id: string;
  scene_id: string | null;
  type: string;
  label: string;
  status: string;
  style_preset_id: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetVersionRow {
  id: string;
  asset_id: string;
  version: number;
  status: string;
  object_key: string | null;
  content_type: string | null;
  payload: string | null;
  prompt: string | null;
  provider: string | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  created_at: string;
}

export const assetRepo = {
  forProject(projectId: string): AssetRow[] {
    return getDb().all('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at', [projectId]) as AssetRow[];
  },
  byScene(projectId: string, sceneId: string, type: AssetType): AssetRow | undefined {
    return getDb().get('SELECT * FROM assets WHERE project_id = ? AND scene_id = ? AND type = ? LIMIT 1', [projectId, sceneId, type]) as
      | AssetRow
      | undefined;
  },
  findById(id: string, projectId: string): AssetRow | undefined {
    return getDb().get('SELECT * FROM assets WHERE id = ? AND project_id = ?', [id, projectId]) as AssetRow | undefined;
  },
  create(a: { id: string; projectId: string; sceneId?: string | null; type: AssetType; label: string; stylePresetId?: string | null; status?: string }): void {
    const t = nowIso();
    getDb().run('INSERT INTO assets (id, project_id, scene_id, type, label, status, style_preset_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [
      a.id, a.projectId, a.sceneId ?? null, a.type, a.label, a.status ?? 'pending', a.stylePresetId ?? null, t, t,
    ]);
  },
  update(id: string, patch: { status?: string; current_version_id?: string | null }): void {
    const sets: string[] = [];
    const params: Params = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.current_version_id !== undefined) { sets.push('current_version_id = ?'); params.push(patch.current_version_id); }
    if (!sets.length) return;
    params.push(nowIso(), id);
    getDb().run(`UPDATE assets SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params);
  },
  version(assetId: string, version: number): AssetVersionRow | undefined {
    return getDb().get('SELECT * FROM asset_versions WHERE asset_id = ? AND version = ?', [assetId, version]) as
      | AssetVersionRow
      | undefined;
  },
  versionById(id: string): AssetVersionRow | undefined {
    return getDb().get('SELECT * FROM asset_versions WHERE id = ?', [id]) as AssetVersionRow | undefined;
  },
  versions(assetId: string): AssetVersionRow[] {
    return getDb().all('SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version DESC', [assetId]) as AssetVersionRow[];
  },
  insertVersion(v: {
    id: string; assetId: string; version: number; status?: string; objectKey?: string | null; contentType?: string | null;
    payload?: unknown; prompt?: string | null; provider?: string | null; durationSec?: number | null;
    width?: number | null; height?: number | null; error?: string | null;
  }): void {
    getDb().run(
      `INSERT INTO asset_versions (id, asset_id, version, status, object_key, content_type, payload, prompt, provider, duration_sec, width, height, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [v.id, v.assetId, v.version, v.status ?? 'pending', v.objectKey ?? null, v.contentType ?? null,
        v.payload === undefined ? null : j(v.payload), v.prompt ?? null, v.provider ?? null,
        v.durationSec ?? null, v.width ?? null, v.height ?? null, v.error ?? null, nowIso()],
    );
  },
  nextVersion(assetId: string): number {
    const r = getDb().get('SELECT MAX(version) AS m FROM asset_versions WHERE asset_id = ?', [assetId]);
    return ((r?.m as number) ?? 0) + 1;
  },
};

export interface MetadataVersionRow {
  id: string;
  project_id: string;
  platform: string;
  version: number;
  source: string;
  prompt: string | null;
  provider: string | null;
  payload: string;
  created_at: string;
}

export const metadataRepo = {
  latest(projectId: string): MetadataVersionRow[] {
    return getDb()
      .all(
        `SELECT m.* FROM metadata_versions m
         JOIN (SELECT platform, MAX(version) AS v FROM metadata_versions WHERE project_id = ? GROUP BY platform) latest
           ON latest.platform = m.platform AND latest.v = m.version
         ORDER BY m.platform`,
        [projectId],
      ) as MetadataVersionRow[];
  },
  latestFor(projectId: string, platform: string): MetadataVersionRow | undefined {
    return getDb().get('SELECT * FROM metadata_versions WHERE project_id = ? AND platform = ? ORDER BY version DESC LIMIT 1', [projectId, platform]) as
      | MetadataVersionRow
      | undefined;
  },
  insert(v: { id: string; projectId: string; platform: string; version: number; prompt?: string | null; provider?: string | null; payload: unknown }): void {
    getDb().run('INSERT INTO metadata_versions (id, project_id, platform, version, source, prompt, provider, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
      v.id, v.projectId, v.platform, v.version, 'ai', v.prompt ?? null, v.provider ?? null, j(v.payload), nowIso(),
    ]);
  },
};

export interface StylePresetRow {
  id: string;
  user_id: string | null;
  name: string;
  description: string;
  built_in: number;
  visual_style: string;
  color_palette: string;
  caption_style: string;
  tone: string;
  music_mood: string | null;
  reference_image_key: string | null;
  swatches: string;
  created_at: string;
}

export const styleRepo = {
  allBuiltIn(): StylePresetRow[] {
    return getDb().all('SELECT * FROM style_presets WHERE built_in = 1 ORDER BY name') as StylePresetRow[];
  },
  allForUser(userId: string): StylePresetRow[] {
    return getDb().all('SELECT * FROM style_presets WHERE built_in = 1 OR user_id = ? ORDER BY built_in DESC, name', [userId]) as StylePresetRow[];
  },
  findById(id: string): StylePresetRow | undefined {
    return getDb().get('SELECT * FROM style_presets WHERE id = ?', [id]) as StylePresetRow | undefined;
  },
  create(p: {
    id: string; userId?: string | null; name: string; description: string; builtIn?: boolean;
    visualStyle: string; colorPalette: string; captionStyle: string; tone: string;
    musicMood?: string | null; referenceImageKey?: string | null; swatches: string[];
  }): void {
    getDb().run(
      `INSERT INTO style_presets (id, user_id, name, description, built_in, visual_style, color_palette, caption_style, tone, music_mood, reference_image_key, swatches, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id, p.userId ?? null, p.name, p.description, p.builtIn ? 1 : 0, p.visualStyle, p.colorPalette,
        p.captionStyle, p.tone, p.musicMood ?? null, p.referenceImageKey ?? null, j(p.swatches), nowIso()],
    );
  },
  deleteCustom(id: string, userId: string): void {
    getDb().run('DELETE FROM style_presets WHERE id = ? AND user_id = ? AND built_in = 0', [id, userId]);
  },
};

export interface ConnectionRow {
  id: string;
  user_id: string;
  platform: string;
  status: string;
  display_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export const connectionRepo = {
  forUser(userId: string): ConnectionRow[] {
    return getDb().all('SELECT * FROM platform_connections WHERE user_id = ? ORDER BY platform', [userId]) as ConnectionRow[];
  },
  byPlatform(userId: string, platform: string): ConnectionRow | undefined {
    return getDb().get('SELECT * FROM platform_connections WHERE user_id = ? AND platform = ?', [userId, platform]) as
      | ConnectionRow
      | undefined;
  },
  upsert(x: { userId: string; platform: string; status: string; displayName?: string | null; accessTokenEnc?: string | null; refreshTokenEnc?: string | null; tokenExpiresAt?: string | null; scopes?: string[] | null; lastError?: string | null }): ConnectionRow {
    const existing = this.byPlatform(x.userId, x.platform);
    const t = nowIso();
    if (existing) {
      getDb().run(
        `UPDATE platform_connections SET status=?, display_name=?, access_token_enc=?, refresh_token_enc=?, token_expires_at=?, scopes=?, last_error=?, updated_at=? WHERE id=?`,
        [x.status, x.displayName ?? null, x.accessTokenEnc ?? null, x.refreshTokenEnc ?? null,
          x.tokenExpiresAt ?? null, x.scopes ? j(x.scopes) : null, x.lastError ?? null, t, existing.id],
      );
      return this.byPlatform(x.userId, x.platform)!;
    }
    const id = makeId('conn');
    getDb().run(
      `INSERT INTO platform_connections (id, user_id, platform, status, display_name, access_token_enc, refresh_token_enc, token_expires_at, scopes, last_error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, x.userId, x.platform, x.status, x.displayName ?? null, x.accessTokenEnc ?? null, x.refreshTokenEnc ?? null,
        x.tokenExpiresAt ?? null, x.scopes ? j(x.scopes) : null, x.lastError ?? null, t, t],
    );
    return this.byPlatform(x.userId, x.platform)!;
  },
  delete(userId: string, platform: string): void {
    getDb().run('DELETE FROM platform_connections WHERE user_id = ? AND platform = ?', [userId, platform]);
  },
  setStatus(id: string, patch: { status: string; lastError?: string | null; accessTokenEnc?: string | null; refreshTokenEnc?: string | null }): void {
    const sets: string[] = [];
    const params: Params = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.lastError !== undefined) { sets.push('last_error = ?'); params.push(patch.lastError); }
    if (patch.accessTokenEnc !== undefined) { sets.push('access_token_enc = ?'); params.push(patch.accessTokenEnc); }
    if (patch.refreshTokenEnc !== undefined) { sets.push('refresh_token_enc = ?'); params.push(patch.refreshTokenEnc); }
    if (!sets.length) return;
    params.push(nowIso(), id);
    getDb().run(`UPDATE platform_connections SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params);
  },
};

export const usageRepo = {
  log(x: {
    providerId: string; userId?: string | null; modality: string; model?: string | null;
    ok?: boolean; tokens?: { input?: number; output?: number }; costUsd?: number; when?: Date;
  }): void {
    const d = (x.when ?? new Date()).toISOString().slice(0, 10);
    getDb().run(
      `INSERT INTO usage_logs (id, provider_id, user_id, modality, model, ok, input_tokens, output_tokens, cost_usd, day, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [makeId('ul'), x.providerId, x.userId ?? null, x.modality, x.model ?? null, x.ok === false ? 0 : 1,
        x.tokens?.input ?? null, x.tokens?.output ?? null, x.costUsd ?? null, d, nowIso()],
    );
  },
  totalsSince(days: number): Array<Row & { day: string; provider_id: string; modality: string; requests: number; errors: number }> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return getDb().all(
      `SELECT day, provider_id, modality, SUM(request_count) AS requests, SUM(CASE WHEN ok = 0 THEN request_count ELSE 0 END) AS errors
       FROM usage_logs WHERE day >= ? GROUP BY day, provider_id, modality ORDER BY day DESC`,
      [since],
    ) as Array<Row & { day: string; provider_id: string; modality: string; requests: number; errors: number }>;
  },
};

export interface PublishJobRow {
  id: string;
  user_id: string;
  project_id: string;
  platform: string;
  status: string;
  mode: string;
  attempts: number;
  max_attempts: number;
  platform_video_id: string | null;
  platform_url: string | null;
  last_error: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export const publishRepo = {
  forProject(projectId: string): PublishJobRow[] {
    return getDb().all('SELECT * FROM publish_jobs WHERE project_id = ? ORDER BY created_at DESC', [projectId]) as PublishJobRow[];
  },
  recentForUser(userId: string, limit = 50): PublishJobRow[] {
    return getDb().all('SELECT * FROM publish_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]) as PublishJobRow[];
  },
  byId(id: string, userId: string): PublishJobRow | undefined {
    return getDb().get('SELECT * FROM publish_jobs WHERE id = ? AND user_id = ?', [id, userId]) as PublishJobRow | undefined;
  },
  create(x: { id: string; userId: string; projectId: string; platform: string; mode: 'draft' | 'auto'; scheduledFor?: string | null }): void {
    const t = nowIso();
    getDb().run(
      `INSERT INTO publish_jobs (id, user_id, project_id, platform, status, mode, attempts, max_attempts, scheduled_for, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [x.id, x.userId, x.projectId, x.platform, 'queued', x.mode, 0, 3, x.scheduledFor ?? null, t, t],
    );
  },
  update(id: string, patch: Partial<{ status: string; attempts: number; platform_video_id: string | null; platform_url: string | null; last_error: string | null }>): void {
    const sets: string[] = [];
    const params: Params = [];
    const map: Record<string, string> = {
      status: 'status', attempts: 'attempts', platform_video_id: 'platform_video_id', platform_url: 'platform_url', last_error: 'last_error',
    };
    for (const [k, col] of Object.entries(map)) {
      if (patch[k as keyof typeof patch] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(patch[k as keyof typeof patch] as string | number | null);
      }
    }
    if (!sets.length) return;
    params.push(nowIso(), id);
    getDb().run(`UPDATE publish_jobs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params);
  },
};

export interface TrendRow {
  id: string;
  source: string;
  title: string;
  category: string | null;
  region: string | null;
  score: number | null;
  url: string | null;
  reason: string | null;
  picked_at: string;
  created_at: string;
}

export const trendRepo = {
  list(opts: { source?: string; region?: string; limit?: number }): TrendRow[] {
    const where: string[] = [];
    const params: Params = [];
    if (opts.source) { where.push('source = ?'); params.push(opts.source); }
    if (opts.region) { where.push('region = ?'); params.push(opts.region); }
    const q = `SELECT * FROM trend_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY picked_at DESC, score DESC LIMIT ?`;
    params.push(opts.limit ?? 100);
    return getDb().all(q, params) as TrendRow[];
  },
  insert(x: { id: string; source: string; title: string; category?: string | null; region?: string | null; score?: number | null; url?: string | null; reason?: string | null; pickedAt?: string }): void {
    const t = nowIso();
    getDb().run(
      `INSERT INTO trend_items (id, source, title, category, region, score, url, reason, picked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [x.id, x.source, x.title, x.category ?? null, x.region ?? null, x.score ?? null, x.url ?? null, x.reason ?? null, x.pickedAt ?? t, t],
    );
  },
  delete(id: string): void {
    getDb().run('DELETE FROM trend_items WHERE id = ?', [id]);
  },
  deleteSourceOlderThan(source: string, isoBefore: string): void {
    getDb().run('DELETE FROM trend_items WHERE source = ? AND picked_at < ?', [source, isoBefore]);
  },
};

export interface AnalyticsRow {
  id: string;
  user_id: string;
  project_id: string;
  platform: string;
  external_video_id: string;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  watch_time_sec: number | null;
  avg_view_duration_sec: number | null;
  collected_at: string;
}

export const analyticsRepo = {
  insert(x: { id: string; userId: string; projectId: string; platform: string; externalVideoId: string; views: number; likes: number; shares: number; comments: number; watchTimeSec?: number | null; avgViewDurationSec?: number | null; collectedAt?: string }): void {
    getDb().run(
      `INSERT INTO analytics_snapshots (id, user_id, project_id, platform, external_video_id, views, likes, shares, comments, watch_time_sec, avg_view_duration_sec, collected_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [x.id, x.userId, x.projectId, x.platform, x.externalVideoId, x.views, x.likes, x.shares, x.comments,
        x.watchTimeSec ?? null, x.avgViewDurationSec ?? null, x.collectedAt ?? nowIso()],
    );
  },
  latestForVideo(platform: string, externalVideoId: string, dayPrefix: string): AnalyticsRow | undefined {
    return getDb().get(
      `SELECT * FROM analytics_snapshots WHERE platform = ? AND external_video_id = ? AND collected_at LIKE ? ORDER BY collected_at DESC LIMIT 1`,
      [platform, externalVideoId, dayPrefix + '%'],
    ) as AnalyticsRow | undefined;
  },
  forProject(projectId: string, days = 30): AnalyticsRow[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return getDb().all(
      'SELECT * FROM analytics_snapshots WHERE project_id = ? AND collected_at >= ? ORDER BY collected_at',
      [projectId, since],
    ) as AnalyticsRow[];
  },
  forUser(userId: string, days = 14): AnalyticsRow[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return getDb().all(
      'SELECT * FROM analytics_snapshots WHERE user_id = ? AND collected_at >= ? ORDER BY collected_at',
      [userId, since],
    ) as AnalyticsRow[];
  },
};


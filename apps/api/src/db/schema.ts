// Single DDL that runs on both SQLite and PostgreSQL (all PKs are TEXT ids,
// timestamps are ISO-8601 TEXT, booleans are 1/0 integers, JSON payloads are
// stored as JSON text). Keeps one query dialect for both drivers.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  idea TEXT,                      -- JSON { prompt, angles[], selectedAngleId }
  current_stage TEXT NOT NULL DEFAULT 'ideation',
  style_preset_id TEXT,
  video_mode TEXT NOT NULL DEFAULT 'auto',   -- auto | slideshow | video-first
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

CREATE TABLE IF NOT EXISTS project_stages (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'not_started',
  progress INTEGER NOT NULL DEFAULT 0,
  status_text TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, stage)
);

CREATE TABLE IF NOT EXISTS script_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source TEXT NOT NULL,           -- ai | manual-edit
  prompt TEXT,
  provider TEXT,
  script TEXT NOT NULL,           -- JSON Scene[] (+ title/overview)
  created_at TEXT NOT NULL,
  UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id TEXT,
  type TEXT NOT NULL,             -- image | video | audio | music | thumbnail | composite | text
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  style_preset_id TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  object_key TEXT,
  content_type TEXT,
  payload TEXT,                   -- JSON (structured text outputs)
  prompt TEXT,
  provider TEXT,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, version)
);
CREATE INDEX IF NOT EXISTS idx_asset_versions_asset ON asset_versions(asset_id);

CREATE TABLE IF NOT EXISTS metadata_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  prompt TEXT,
  provider TEXT,
  payload TEXT NOT NULL,          -- JSON { title, description, hashtags[], thumbnailConcepts[], thumbnailAssetIds[] }
  created_at TEXT NOT NULL,
  UNIQUE (project_id, platform, version)
);

CREATE TABLE IF NOT EXISTS style_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  visual_style TEXT NOT NULL,
  color_palette TEXT NOT NULL,
  caption_style TEXT NOT NULL,
  tone TEXT NOT NULL,
  music_mood TEXT,
  reference_image_key TEXT,
  swatches TEXT NOT NULL,         -- JSON string[]
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',  -- disconnected | connecting | connected | error | locked
  display_name TEXT,
  access_token_enc TEXT,          -- AES-256-GCM envelope, encrypted at rest
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scopes TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, platform)
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  base_url TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  api_shape TEXT NOT NULL,
  auth_header TEXT,
  modalities TEXT NOT NULL,       -- JSON
  rate_limit TEXT,
  free_tier INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled_modalities TEXT,        -- JSON subset of modalities
  models TEXT NOT NULL,           -- JSON alias->model map
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  user_id TEXT,
  modality TEXT NOT NULL,
  model TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  request_count INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_logs(day, provider_id);

CREATE TABLE IF NOT EXISTS trend_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,           -- youtube-most-popular | manual | third-party
  title TEXT NOT NULL,
  category TEXT,
  region TEXT,
  score REAL,
  url TEXT,
  reason TEXT,
  picked_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trends_picked ON trend_items(picked_at);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | draft_ready | processing | published | failed | needs_action
  mode TEXT NOT NULL DEFAULT 'auto',       -- draft | auto
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  platform_video_id TEXT,
  platform_url TEXT,
  last_error TEXT,
  scheduled_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_user ON publish_jobs(user_id);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_video_id TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  watch_time_sec REAL,
  avg_view_duration_sec REAL,
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_video ON analytics_snapshots(platform, external_video_id, collected_at);
CREATE INDEX IF NOT EXISTS idx_analytics_project ON analytics_snapshots(project_id, collected_at);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const SCHEMA_VERSION = '1';

import type { ProjectDetail } from './hooks';

export interface Scene {
  id: string;
  visual_description: string;
  voiceover: string;
  on_screen_text: string;
  duration_sec: number;
}

export interface AssetVersionInfo {
  id: string;
  version: number;
  status: string;
  provider: string | null;
  contentType: string | null;
  createdAt: string;
  durationSec: number | null;
}

export interface AssetInfo {
  id: string;
  sceneId: string | null;
  type: string;
  label: string;
  status: string;
  currentVersion: {
    id: string;
    version: number;
    contentType: string | null;
    durationSec: number | null;
    provider: string | null;
    prompt: string | null;
    error: string | null;
    createdAt: string;
  } | null;
  versions: AssetVersionInfo[];
  versionCount: number;
}

export interface StylePresetInfo {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  visualStyle: string;
  captionStyle: string;
  tone: string;
  musicMood?: string | null;
  swatches: string[];
}

export interface MetadataRow {
  platform: string;
  version: number;
  createdAt: string;
  title: string;
  description: string;
  hashtags: string[];
  thumbnailConcepts: string[];
}

export interface PublishJobInfo {
  id: string;
  platform: string;
  status: string;
  mode: 'draft' | 'auto';
  attempts: number;
  maxAttempts: number;
  platformVideoId: string | null;
  platformUrl: string | null;
  lastError: string | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioData {
  project: ProjectDetail;
  styles: StylePresetInfo[];
  script: {
    latest: { id: string; version: number; source: string; createdAt: string; scenes: Scene[]; title: string; overview: string } | null;
    versions: Array<{ id: string; version: number; source: string; createdAt: string; scenes: Scene[]; title: string | null }>;
  } | null;
  assets: AssetInfo[];
  metadata: MetadataRow[];
  jobs: PublishJobInfo[];
}

export interface PlatformRow {
  platform: string;
  label: string;
  format: { aspect: string; maxDurationSec: number; captionMaxLength: number };
  gate: string;
  gateNote: string;
  live: boolean;
  connection: { id: string; status: string; displayName: string | null; lastError: string | null } | null;
}

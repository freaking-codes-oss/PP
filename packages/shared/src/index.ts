import { z } from 'zod';

// ---------------------------------------------------------------------------
// Stages & pipeline
// ---------------------------------------------------------------------------

export enum PipelineStage {
  IDEATION = 'ideation',
  SCRIPT = 'script',
  ASSETS = 'assets',
  ASSEMBLY = 'assembly',
  METADATA = 'metadata',
  REVIEW = 'review',
  PUBLISH = 'publish',
}

export const STAGE_ORDER: PipelineStage[] = [
  PipelineStage.IDEATION,
  PipelineStage.SCRIPT,
  PipelineStage.ASSETS,
  PipelineStage.ASSEMBLY,
  PipelineStage.METADATA,
  PipelineStage.REVIEW,
  PipelineStage.PUBLISH,
];

export interface StageStatus {
  stage: PipelineStage;
  state: 'not_started' | 'running' | 'ready' | 'error' | 'blocked';
  progress?: number; // 0..100 within the stage
  statusText?: string; // plain-language status surfaced in the UI
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Ideation (Stage 1)
// ---------------------------------------------------------------------------

export const contentAngleSchema = z.object({
  id: z.string(),
  title: z.string(),
  hook: z.string(),
  angle: z.string().describe('what makes this take distinct'),
  audience: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

export type ContentAngle = z.infer<typeof contentAngleSchema>;

// ---------------------------------------------------------------------------
// Script / scene breakdown (Stage 2) — spec-defined shape
// ---------------------------------------------------------------------------

export const sceneSchema = z.object({
  id: z.string(),
  visual_description: z.string(),
  voiceover: z.string(),
  on_screen_text: z.string(),
  duration_sec: z.number().positive(),
});

export type Scene = z.infer<typeof sceneSchema>;

export const scriptSchema = z.object({
  title: z.string().optional(),
  overview: z.string().optional(),
  scenes: z.array(sceneSchema),
});

export type Script = z.infer<typeof scriptSchema>;

// ---------------------------------------------------------------------------
// Assets & versions (Stage 3+)
// ---------------------------------------------------------------------------

export enum AssetType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  MUSIC = 'music',
  THUMBNAIL = 'thumbnail',
  COMPOSITE = 'composite', // final assembled video
  TEXT = 'text',
}

export type AssetStatus = 'pending' | 'processing' | 'ready' | 'error';

export interface AssetVersion {
  id: string;
  assetId: string;
  version: number;
  status: AssetStatus;
  // where the generated object lives (object-store key or file path)
  objectKey?: string | null;
  contentType?: string | null;
  // human/JSON payload for text-like assets
  payload?: unknown | null;
  prompt?: string | null;
  provider?: string | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
  createdAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  sceneId?: string | null;
  type: AssetType;
  label: string;
  status: AssetStatus;
  currentVersionId?: string | null;
  stylePresetId?: string | null;
  versions: AssetVersion[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Metadata (Stage 5)
// ---------------------------------------------------------------------------

export interface PlatformMetadata {
  platform: string; // e.g. 'youtube'
  title: string;
  description: string;
  hashtags: string[];
  thumbnailConcepts: string[];
}

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  visualStyle: string;
  colorPalette: string;
  captionStyle: string;
  tone: string;
  musicMood?: string;
  referenceImageKey?: string | null;
  // hex swatches for the gallery
  swatches: string[];
}

// ---------------------------------------------------------------------------
// Trend feeds
// ---------------------------------------------------------------------------

export interface TrendItem {
  id: string;
  source: string; // 'youtube-most-popular' | 'manual' | 'third-party'
  title: string;
  category?: string | null;
  region?: string | null;
  score?: number | null; // normalized popularity score
  url?: string | null;
  reason?: string | null; // manual curation note
  pickedAt: string;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export enum PlatformId {
  YOUTUBE = 'youtube',
  TIKTOK = 'tiktok',
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
}

export type PublishJobStatus =
  | 'queued'
  | 'draft_ready'
  | 'processing'
  | 'published'
  | 'failed'
  | 'needs_action';

export interface PublishJob {
  id: string;
  projectId: string;
  platform: PlatformId;
  status: PublishJobStatus;
  mode: 'draft' | 'auto';
  retries: number;
  maxRetries: number;
  platformVideoId?: string | null;
  platformUrl?: string | null;
  lastError?: string | null;
  scheduledFor?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface PlatformAnalytics {
  id: string;
  projectId: string;
  platform: PlatformId;
  externalVideoId: string;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  watchTimeSec?: number | null;
  avgViewDurationSec?: number | null;
  collectedAt: string;
}

// ---------------------------------------------------------------------------
// Project summary shape used by list/detail APIs
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  id: string;
  name: string;
  idea: string;
  currentStage: PipelineStage;
  stageStates: Record<string, 'not_started' | 'running' | 'ready' | 'error' | 'blocked'>;
  createdAt: string;
  updatedAt: string;
}

export * from './providers';
export * from './registry';
export * from './formats';

export const CASErrorCode = z.enum([
  'BAD_REQUEST',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'CONFLICT',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'VALIDATION',
  'INTERNAL',
]);

export type CASErrorCode = z.infer<typeof CASErrorCode>;

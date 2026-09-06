// ---------------------------------------------------------------------------
// AI provider registry — config-driven provider metadata (Layer 1).
// The registry describes capabilities; the API server supplies credentials
// from the encrypted secrets store at call time (never stored here).
// ---------------------------------------------------------------------------

export enum Modality {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  SPEECH = 'speech',
  EMBEDDINGS = 'embeddings',
}

export type AuthMethod = 'bearer' | 'apiKey' | 'x-goog-api-key' | 'none';

export type ApiShape = 'openai' | 'anthropic' | 'google' | 'custom';

export type CostUnit = 'per-1k-tokens' | 'per-image' | 'per-video-sec' | 'per-char';

export interface ProviderRateLimit {
  requestsPerMin: number;
  dailyRequests?: number;
  dailyTokens?: number;
}

export interface ProviderCost {
  unit: CostUnit;
  amountUsd: number;
}

export interface ProviderRegistryEntry {
  id: string;
  name: string;
  // Short human label e.g. "OpenRouter (test:free)"
  description?: string;
  baseUrl: string;
  authMethod: AuthMethod;
  apiShape: ApiShape;
  // header key used for bearer/apiKey auth, e.g. 'Authorization' or 'x-api-key'
  authHeader?: string;
  supportedModalities: Modality[];
  rateLimit?: ProviderRateLimit;
  cost?: ProviderCost;
  // router hints
  freeTier: boolean;
  // map modelName -> real upstream model id
  models: Record<string, string>;
}

// Identifier used when talking to adapters (registry "generation model").
export type ModelName =
  | 'fast-text'
  | 'cheap-text'
  | 'vision-text'
  | 'image'
  | 'video'
  | 'tts';

// Options structs carry generation parameters only — the content itself
// (prompt / text) is always a positional argument to the router & adapters.
export interface TextGenerationOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  // prefer image-input capable models (for ideation from thumbnails etc.)
  vision?: boolean;
}

export interface ImageGenerationOptions {
  width?: number;
  height?: number;
  styleParams?: Record<string, string>;
}

export interface VideoSceneSpec {
  visual_description: string;
  voiceover?: string;
  duration_sec?: number;
}

export interface VideoGenerationOptions {
  width?: number;
  height?: number;
}

export interface SpeechGenerationOptions {
  voice?: string;
  speed?: number;
}

export interface GeneratedText {
  text: string;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface GeneratedAsset {
  provider: string;
  model: string;
  // bytes for image/audio/embeddings-style outputs
  buffer?: Buffer;
  contentType?: string;
  // remote URL when a provider hands back a URL instead of bytes
  remoteUrl?: string;
  // structured output when generateText is asked for jsonMode
  data?: unknown;
  durationSec?: number;
  width?: number;
  height?: number;
}

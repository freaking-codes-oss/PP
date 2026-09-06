import type { Modality } from '@cas/shared';
import type {
  ImageGenerationOptions, TextGenerationOptions, SpeechGenerationOptions,
  VideoGenerationOptions, VideoSceneSpec, GeneratedText, GeneratedAsset,
} from '@cas/shared';
import type { ProviderConfigRow } from './configRepo';
import { classifyHttpError, fetchJson, type FailureDetail } from './http';
import { secretStore } from '../secrets';
import { logger } from '../logger';
import { ideate, script, metadataForPlatform } from './mockBrain';
import { paintPoster } from './mockPaint';
import { speak as mockSpeak } from './mockTts';
import { AppError } from '../errors';

export interface ProviderAdapter {
  readonly providerId: string;
  supports(modality: Modality): boolean;
  generateText(prompt: string, options: TextGenerationOptions & { mockTask?: 'ideation' | 'script' | 'metadata'; mockPayload?: unknown }): Promise<GeneratedText>;
  generateImage(prompt: string, options: ImageGenerationOptions & { seed?: string; mockPayload?: unknown }): Promise<GeneratedAsset>;
  generateSpeech(text: string, options: SpeechGenerationOptions & { maxSec?: number }): Promise<GeneratedAsset>;
  generateVideo(sceneSpec: VideoSceneSpec, options: VideoGenerationOptions): Promise<GeneratedAsset>;
}

// ===================== shared OpenAI-compatible client ======================

function authHeaderFor(cfg: ProviderConfigRow): { key: string; value: string } | null {
  const secret = secretStore.get({ kind: 'provider-key', name: cfg.id });
  if (!secret) return null;
  if (cfg.auth_header) return { key: cfg.auth_header, value: secret };
  if (cfg.auth_method === 'x-goog-api-key') return { key: 'x-goog-api-key', value: secret };
  if (cfg.auth_method === 'apiKey') return { key: 'x-api-key', value: secret };
  return { key: 'Authorization', value: `Bearer ${secret}` };
}

function extractText(body: any): { text: string; usage?: { inputTokens: number; outputTokens: number } } {
  const content: string | undefined = body?.choices?.[0]?.message?.content;
  const text = (content ?? body?.output_text ?? '').trim();
  const usage = body?.usage;
  return {
    text,
    usage: usage
      ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 }
      : undefined,
  };
}

class OpenAiCompatibleAdapter implements ProviderAdapter {
  constructor(public cfg: ProviderConfigRow) {}

  get providerId(): string {
    return this.cfg.id;
  }

  private modalities(): Modality[] {
    try { return JSON.parse(this.cfg.modalities) as Modality[]; } catch { return []; }
  }
  supports(modality: Modality): boolean {
    return this.modalities().includes(modality);
  }
  private model(alias: string): string | null {
    try {
      const models = JSON.parse(this.cfg.models) as Record<string, string>;
      return models[alias] ?? null;
    } catch { return null; }
  }

  private async post(path: string, body: unknown, timeoutMs = 60_000): Promise<{ status: number; body: any }> {
    const auth = authHeaderFor(this.cfg);
    if (!auth) {
      throw new AppError({ code: 'UNAUTHORIZED', status: 502, userMessage: `No API key stored for ${this.cfg.name}.`, suggestion: 'Add the key in Settings → AI providers.' });
    }
    const url = `${this.cfg.base_url.replace(/\/$/, '')}${path}`;
    const res = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [auth.key]: auth.value },
      body: JSON.stringify(body),
      timeoutMs,
    });
    if (res.status >= 400) {
      const detail = classifyHttpError({ status: res.status, body: res.body });
      throw toAdapterError(detail);
    }
    return { status: res.status, body: res.body as any };
  }

  async generateText(prompt: string, options: TextGenerationOptions): Promise<GeneratedText> {
    const model =
      this.model(options.vision ? 'vision-text' : options.jsonMode ? 'cheap-text' : 'fast-text') ??
      this.model('fast-text');
    if (!model) throw new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: `${this.cfg.name} has no model for this task.` });
    const body: any = {
      model,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    };
    if (options.jsonMode) body.response_format = { type: 'json_object' };
    const res = await this.post('/chat/completions', body, 90_000);
    const { text, usage } = extractText(res.body);
    return { text, provider: this.cfg.id, model, usage };
  }

  async generateImage(prompt: string, options: ImageGenerationOptions): Promise<GeneratedAsset> {
    const model = this.model('image');
    if (!model) throw new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: `${this.cfg.name} has no image model configured.` });
    const size = `${options.width ?? 720}x${options.height ?? 1280}`;
    const res = await this.post('/images/generations', { model, prompt, n: 1, size }, 180_000);
    const data = res.body?.data?.[0];
    if (data?.b64_json) {
      return { provider: this.cfg.id, model, buffer: Buffer.from(data.b64_json, 'base64'), contentType: 'image/png' };
    }
    if (data?.url) {
      const img = await fetch(data.url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: 'Image provider returned an unreadable URL.' });
      const buf = Buffer.from(await img.arrayBuffer());
      return { provider: this.cfg.id, model, buffer: buf, contentType: img.headers.get('content-type') ?? 'image/png', remoteUrl: data.url };
    }
    throw new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: 'Image provider returned an empty result.' });
  }

  async generateSpeech(): Promise<GeneratedAsset> {
    throw new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: 'This provider cannot generate speech.' });
  }
  async generateVideo(): Promise<GeneratedAsset> {
    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      userMessage: 'True AI video generation requires a video provider driver — CAS falls back to the image + Ken Burns slideshow.',
    });
  }
}

function toAdapterError(detail: FailureDetail): AppError {
  return new AppError({
    code: detail.kind === 'auth-invalid' || detail.kind === 'no-key' ? 'UNAUTHORIZED'
      : detail.kind === 'quota-exceeded' ? 'QUOTA_EXCEEDED'
      : detail.kind === 'rate-limited' ? 'RATE_LIMITED'
      : 'PROVIDER_UNAVAILABLE',
    status: 502,
    userMessage: detail.message,
    suggestion: detail.suggestion,
  });
}

// ===================== mock adapter =====================

class MockAdapter implements ProviderAdapter {
  get providerId() {
    return 'mock';
  }
  private supportsAll: Modality[] = ['text', 'image', 'video', 'speech'] as Modality[];
  supports(modality: Modality): boolean { return this.supportsAll.includes(modality); }

  async generateText(prompt: string, options: TextGenerationOptions & { mockTask?: string; mockPayload?: any }): Promise<GeneratedText> {
    await delay(400 + Math.floor(Math.random() * 400));
    if (options.mockTask) return this.dispatchText(options.mockTask, options.mockPayload ?? {});
    return {
      text: `[mock] Echo of your request (${prompt.length} chars). Connect a real provider key to get model output.`,
      provider: 'mock',
      model: 'mock-text',
      usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: 32 },
    };
  }

  private dispatchText(task: string, payload: any): GeneratedText {
    const cases: Record<string, () => string> = {
      ideation: () => JSON.stringify(ideate(payload)),
      script: () => JSON.stringify(script(payload)),
      metadata: () => JSON.stringify(metadataForPlatform(payload)),
    };
    const text = cases[task]?.() ?? JSON.stringify({ ok: true });
    return { text, provider: 'mock', model: 'mock-text', usage: { inputTokens: 150, outputTokens: 500 } };
  }

  async generateImage(prompt: string, options: ImageGenerationOptions & { seed?: string; mockPayload?: any }): Promise<GeneratedAsset> {
    await delay(250 + Math.floor(Math.random() * 300));
    const p = options.mockPayload as
      | { colors?: string[]; paletteKey?: string; variant?: number; width?: number; height?: number }
      | undefined;
    const png = paintPoster({
      seed: options.seed ?? `img:${prompt.slice(0, 80)}`,
      paletteKey: p?.paletteKey,
      colors: p?.colors,
      variant: p?.variant ?? 0,
      width: p?.width ?? 720,
      height: p?.height ?? 1280,
    });
    return { provider: 'mock', model: 'mock-image', buffer: png, contentType: 'image/png', width: p?.width ?? 720, height: p?.height ?? 1280 };
  }

  async generateSpeech(text: string, options: SpeechGenerationOptions & { maxSec?: number }): Promise<GeneratedAsset> {
    await delay(150);
    try {
      const { wav, durationSec, wpm } = await mockSpeak(text, {
        voice: options.voice ?? 'en-us',
        speed: options.speed,
        maxSec: options.maxSec,
      });
      logger.info(`mock TTS: ${text.length} chars → ${durationSec.toFixed(1)}s @ ${wpm}wpm`);
      return { provider: 'mock', model: 'mock-tts-espeak', buffer: wav, contentType: 'audio/wav', durationSec };
    } catch (e) {
      // TTS is best-effort on the free path; degrade to silence rather than fail the scene.
      logger.warn('mock TTS unavailable, using silence', e);
      const secs = Math.min(8, Math.max(2, Math.ceil(text.length / 14)));
      const { silenceWav } = await import('./silence');
      return { provider: 'mock', model: 'mock-tts-silence', buffer: silenceWav(secs), contentType: 'audio/wav', durationSec: secs };
    }
  }

  async generateVideo(): Promise<GeneratedAsset> {
    // Deliberately fails: even the demo provider cannot render true video — this
    // exercises the graceful-degradation path (images + Ken Burns slideshow).
    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      status: 502,
      userMessage: 'Demo mode cannot generate true video clips.',
      suggestion: 'CAS automatically falls back to the slideshow path.',
    });
  }
}

export function adapterFor(cfg: ProviderConfigRow): ProviderAdapter {
  if (cfg.id === 'mock' || cfg.api_shape === 'custom') return new MockAdapter();
  return new OpenAiCompatibleAdapter(cfg);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

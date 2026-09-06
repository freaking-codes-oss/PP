// AI Provider Router (Layer 1 core).
//
// Responsibilities:
//  - candidate selection: enabled providers whose capability set includes the
//    requested modality AND that have a key stored (mock excluded), ordered by
//    priority then free-tier-first;
//  - routing strategy: priority | capability | load (skip providers near their
//    daily quota);
//  - fallback chain: on failure classify and try the next candidate;
//  - usage tracking per provider/day.
//
// The router NEVER sees raw API keys — adapters fetch them from the encrypted
// secrets store at call time.
import { Modality } from '@cas/shared';
import type {
  TextGenerationOptions, ImageGenerationOptions, SpeechGenerationOptions,
  VideoGenerationOptions, VideoSceneSpec, GeneratedText, GeneratedAsset,
} from '@cas/shared/providers';
import { config } from '../config';
import { AppError } from '../errors';
import { logger } from '../logger';
import { secretStore } from '../secrets';
import { usageRepo } from '../db/repos';
import { adapterFor } from './adapters';
import { providerConfigRepo, ProviderConfigRow } from './configRepo';
import { classifyHttpError, isRetryableKind } from './http';

export interface RouterAttempt {
  providerId: string;
  providerName: string;
  ok: boolean;
  skipped?: string; // human reason when not attempted
  message?: string; // outcome text (plain language)
  model?: string;
}

export interface RouterResult<T> {
  data: T;
  providerId: string;
  model?: string;
  attempts: RouterAttempt[];
  // true when we fell back from the first choice
  usedFallback: boolean;
}

type ModalityKey = 'text' | 'image' | 'video' | 'speech';

function modalityToKey(m: Modality): ModalityKey {
  switch (m) {
    case Modality.TEXT: return 'text';
    case Modality.IMAGE: return 'image';
    case Modality.VIDEO: return 'video';
    case Modality.SPEECH: return 'speech';
    default: return 'text';
  }
}

function hasKey(cfg: ProviderConfigRow): boolean {
  if (cfg.id === 'mock') return config.allowMock;
  return secretStore.has({ kind: 'provider-key', name: cfg.id });
}

/** All usable providers for a modality, in routing order. */
export function candidatesFor(modality: Modality, strategy = config.CAS_ROUTING_STRATEGY): ProviderConfigRow[] {
  const rows = providerConfigRepo.all();
  const todayCounts = new Map<string, number>();
  if (strategy === 'load') {
    for (const row of usageRepo.totalsSince(1)) {
      const key = `${row.provider_id}:${row.modality}`;
      todayCounts.set(key, (todayCounts.get(key) ?? 0) + Number(row.requests));
    }
  }
  const key = modalityToKey(modality);
  const list = rows.filter((cfg) => {
    if (!cfg.enabled) return false;
    if (!providerConfigRepo.modalitiesOf(cfg).includes(modality)) return false;
    if (!hasKey(cfg)) return false;
    if (strategy === 'capability') return true; // capability match only
    if (strategy === 'load') {
      const limit = parseLimit(cfg);
      const used = todayCounts.get(`${cfg.id}:${key}`) ?? 0;
      if (limit > 0 && used >= limit) return false; // skip providers near quota
    }
    return true;
  });
  // priority asc; equal priority: free tier first, then name
  list.sort((a, b) => a.priority - b.priority || (b.free_tier - a.free_tier) || a.name.localeCompare(b.name));
  return list;
}

function parseLimit(cfg: ProviderConfigRow): number {
  try {
    const rl = cfg.rate_limit ? (JSON.parse(cfg.rate_limit) as { dailyRequests?: number }) : undefined;
    return rl?.dailyRequests ?? 0;
  } catch { return 0; }
}

export interface RouteMeta {
  userId?: string | null;
}

class Router {
  private async runWithFallback<T>(
    modality: Modality,
    call: (cfg: ProviderConfigRow, idx: number) => Promise<T>,
    describe: (data: T) => { model?: string },
    meta: RouteMeta,
  ): Promise<RouterResult<T>> {
    const candidates = candidatesFor(modality);
    const attempts: RouterAttempt[] = [];
    let lastError: AppError | null = null;
    let idx = 0;

    if (candidates.length === 0) {
      const friendly =
        modality === Modality.TEXT || modality === Modality.IMAGE
          ? 'No AI provider is configured for this step. Add an API key in Settings → AI providers (the demo mock is enabled by default).'
          : `No provider supports ${modality} generation right now — CAS will use the slideshow fallback instead.`;
      throw new AppError({
        code: modality === Modality.TEXT || modality === Modality.IMAGE ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',
        status: 502,
        userMessage: friendly,
        suggestion: 'Add a provider key or switch to the built-in demo mock.',
      });
    }

    // deterministic order without mutating candidates array
    const order = [...candidates.keys()];
    for (const i of order) {
      const cfg = candidates[i];
      idx++;
      const label = cfg.id === 'mock' ? 'Demo mock' : cfg.name;
      try {
        const data = await call(cfg, idx);
        const { model } = describe(data);
        usageRepo.log({ providerId: cfg.id, userId: meta.userId ?? null, modality: modalityToKey(modality), model: model ?? null });
        attempts.push({ providerId: cfg.id, providerName: label, ok: true, model });
        logger.info(`[router] ${modality} via ${cfg.id}${model ? ` (${model})` : ''} after ${idx - 1} fallback(s)`);
        return { data, providerId: cfg.id, model, attempts, usedFallback: idx > 1 };
      } catch (e) {
        lastError = e instanceof AppError ? e : new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: 'Provider failed.', cause: e });
        usageRepo.log({ providerId: cfg.id, userId: meta.userId ?? null, modality: modalityToKey(modality), ok: false });
        const detail = classifyHttpError(e);
        const skipReason = detail.kind;
        attempts.push({
          providerId: cfg.id,
          providerName: label,
          ok: false,
          message: plainFailure(detail.kind, cfg),
          skipped: undefined,
        });
        void skipReason;
        logger.warn(`[router] ${modality} via ${cfg.id} failed — ${lastError.userMessage}`);
        if (!isRetryableKind(detail.kind)) {
          // auth/config problems won't improve by switching providers silently;
          // remember them but keep trying others (user gets full chain report)
        }
      }
    }
    const aggregate = new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      status: 502,
      userMessage:
        'Every available AI provider failed on this step. Your content is saved — try again in a minute, or edit the result manually.',
      suggestion: 'Regenerate, add a new provider key, or continue with manual edits.',
      cause: lastError ?? undefined,
    });
    (aggregate as AppError & { attempts?: RouterAttempt[] }).attempts = attempts;
    throw aggregate;
  }

  generateText(
    prompt: string,
    options: TextGenerationOptions & { mockTask?: 'ideation' | 'script' | 'metadata'; mockPayload?: unknown },
    meta: RouteMeta = {},
  ): Promise<RouterResult<GeneratedText>> {
    return this.runWithFallback(
      Modality.TEXT,
      (cfg) => adapterFor(cfg).generateText(prompt, options),
      (d) => ({ model: d.model }),
      meta,
    );
  }

  generateImage(
    prompt: string,
    options: ImageGenerationOptions & { seed?: string; mockPayload?: unknown },
    meta: RouteMeta = {},
  ): Promise<RouterResult<GeneratedAsset>> {
    return this.runWithFallback(
      Modality.IMAGE,
      (cfg) => adapterFor(cfg).generateImage(prompt, options),
      (d) => ({ model: d.model }),
      meta,
    );
  }

  generateSpeech(
    text: string,
    options: SpeechGenerationOptions & { maxSec?: number },
    meta: RouteMeta = {},
  ): Promise<RouterResult<GeneratedAsset>> {
    return this.runWithFallback(
      Modality.SPEECH,
      (cfg) => adapterFor(cfg).generateSpeech(text, options),
      (d) => ({ model: d.model }),
      meta,
    );
  }

  generateVideo(sceneSpec: VideoSceneSpec, options: VideoGenerationOptions, meta: RouteMeta = {}): Promise<RouterResult<GeneratedAsset>> {
    return this.runWithFallback(
      Modality.VIDEO,
      (cfg) => adapterFor(cfg).generateVideo(sceneSpec, options),
      (d) => ({ model: d.model }),
      meta,
    );
  }

  /** Whether at least one usable provider exists for a modality (drives degradation). */
  hasCapability(modality: Modality): boolean {
    return candidatesFor(modality).length > 0;
  }
}

function plainFailure(kind: string, cfg: ProviderConfigRow): string {
  switch (kind) {
    case 'no-key': return `${cfg.name}: no API key stored — skipped.`;
    case 'rate-limited': return `${cfg.name}: rate limited — trying next provider…`;
    case 'quota-exceeded': return `${cfg.name}: daily quota reached — trying next provider…`;
    case 'auth-invalid': return `${cfg.name}: key rejected — check the key.`;
    case 'timeout': return `${cfg.name}: timed out — trying next provider…`;
    case 'network': return `${cfg.name}: unreachable — trying next provider…`;
    case 'provider-error': return `${cfg.name}: provider error — trying next provider…`;
    default: return `${cfg.name}: failed — trying next provider…`;
  }
}

export const router = new Router();

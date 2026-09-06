// Stage orchestration: metadata generation (5), assembly (4), and the
// auto-run chain used by the wizard's "Run to publish-ready" button.
import { AssetType, PipelineStage, PlatformId, sceneSchema } from '@cas/shared';
import { scriptSchema } from '@cas/shared';
import type { Scene } from '@cas/shared';
import { AppError } from '../errors';
import { logger } from '../logger';
import { assetRepo, metadataRepo, projectRepo, scriptRepo, publishRepo, type ProjectRow } from '../db/repos';
import { objectStore } from '../storage';
import { router, type RouterResult } from '../providers/router';
import { makeId, nowIso } from '../util';
import { setStage, setStageRunning, setStageReady, setStageError } from '../stage';
import { parseScenes, ensureMusicAsset, runAssetsStage } from './assets';
import type { GeneratedText } from '@cas/shared/providers';
import { PLATFORM_FORMATS } from '@cas/shared/formats';

// ---------------------------------------------------------------------------
// Ideation & script helpers (used by routes directly)
// ---------------------------------------------------------------------------

export function readIdea(project: ProjectRow): { prompt?: string; angles?: any[]; selectedAngleId?: string | null; hooks?: any[] } | null {
  try {
    return project.idea ? JSON.parse(project.idea) : null;
  } catch {
    return null;
  }
}

export function topicFromProject(project: ProjectRow): string {
  const idea = readIdea(project);
  const angle = idea?.angles?.find((a: any) => a.id === idea?.selectedAngleId);
  if (angle?.title) return angle.title;
  const prompt = idea?.prompt ?? project.name;
  return prompt.replace(/^generate (a )?(video|short) (about|on) /i, '').replace(/[.!?]+$/, '').trim();
}

export async function generateIdeation(input: { project: ProjectRow; prompt?: string; trendContext?: string[]; userId?: string }): Promise<{ idea: any; provider: string; usedFallback: boolean; attempts: any[] }> {
  const prompt = (input.prompt ?? readIdea(input.project)?.prompt ?? input.project.name).trim();
  if (!prompt) throw AppError.badRequest('Enter a topic or idea first.');
  const mockPayload = {
    topic: prompt.replace(/[.!?]+$/, ''),
    trends: (input.trendContext ?? []).map((title) => ({ title })),
  };
  const res = await router.generateText(prompt, {
    system: `You are the ideation engine of Content Automation Studio. Expand the user's idea into 3-4 distinct short-form video angles. Reply with ONLY JSON: {"angles":[{"id":"angle_1","title":"...","hook":"one-line hook","angle":"why this take is distinct","audience":"who it serves","difficulty":"easy|medium|hard"}]}. No markdown, no code fences.`,
    jsonMode: true,
    mockTask: 'ideation' as const,
    mockPayload,
  }, { userId: input.userId });
  const parsed = parseJsonObject(res.data.text, 'ideation');
  return { idea: { ...parsed, prompt, hooks: parsed.hooks }, provider: res.providerId, usedFallback: res.usedFallback, attempts: res.attempts };
}

export async function generateScript(input: { project: ProjectRow; sceneCount?: number; userId?: string }): Promise<{ scriptVersion: { id: string; version: number; script: any; provider: string | null }; usedFallback: boolean }> {
  const idea = readIdea(input.project);
  const angle = idea?.angles?.find((a: any) => a.id === idea?.selectedAngleId) ?? idea?.angles?.[0];
  const topic = topicFromProject(input.project);
  const version = (scriptRepo.latest(input.project.id)?.version ?? 0) + 1;
  const system = [
    'You are the script engine of Content Automation Studio.',
    'Write a short-form vertical video script (total 28-40 seconds) for social platforms.',
    'Respond with ONLY valid JSON:',
    JSON.stringify({
      title: 'working title',
      overview: 'one sentence',
      scenes: [
        { id: 'scene_1', visual_description: 'what the viewer sees — subject, camera move, style', voiceover: 'spoken line, 1-2 sentences, conversational', on_screen_text: 'caption <= 5 words', duration_sec: 4 },
      ],
    }),
    'Rules: 5-7 scenes. Scene 1 is a scroll-stopping hook; the last scene is a call to action. duration_sec between 4 and 7. No markdown or code fences — JSON only.',
  ].join('\n');
  const res = await router.generateText(JSON.stringify({
    topic,
    angleTitle: angle?.title,
    angleHook: angle?.hook,
    sceneCount: input.sceneCount,
  }), {
    system,
    temperature: 0.8,
    jsonMode: true,
    mockTask: 'script' as const,
    mockPayload: { topic, angleTitle: angle?.title, angleHook: angle?.hook, sceneCount: input.sceneCount, style: undefined },
  }, { userId: input.userId });

  const parsed = parseJsonObject(res.data.text, 'script');
  const validated = validateScriptShape(parsed);
  const scriptId = makeId('scr');
  scriptRepo.insert({ id: scriptId, projectId: input.project.id, version, source: 'ai', prompt: `script v${version}`, provider: res.providerId, script: validated });
  return { scriptVersion: { id: scriptId, version, script: validated, provider: res.providerId }, usedFallback: res.usedFallback };
}

function validateScriptShape(parsed: any): { title?: string; overview?: string; scenes: Scene[] } {
  const doc = { title: parsed?.title ?? '', overview: parsed?.overview ?? '', scenes: parsed?.scenes ?? parsed };
  const result = scriptSchema.safeParse(doc);
  if (!result.success) {
    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      userMessage: 'The AI returned a script that did not match the expected scene structure.',
      suggestion: 'Try again — most providers produce valid JSON on the second attempt.',
    });
  }
  return result.data;
}

function parseJsonObject(text: string, label: string): any {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      userMessage: `The AI provider returned unparseable output for ${label}.`,
      suggestion: 'Try again or edit manually.',
    });
  }
}

// ---------------------------------------------------------------------------
// Stage 5 — per-platform metadata
// ---------------------------------------------------------------------------

const PLATFORMS_DEFAULT: PlatformId[] = [PlatformId.YOUTUBE, PlatformId.TIKTOK, PlatformId.INSTAGRAM, PlatformId.FACEBOOK];

export async function generateMetadataForProject(input: { project: ProjectRow; platforms?: PlatformId[]; userId?: string; report?: (text: string) => void }): Promise<void> {
  const latest = scriptRepo.latest(input.project.id);
  if (!latest) throw AppError.badRequest('Generate the script first — metadata describes the finished video.');
  const script = parseScenes(latest.script);
  const idea = readIdea(input.project);
  const angle = idea?.angles?.find((a: any) => a.id === idea?.selectedAngleId) ?? idea?.angles?.[0];
  const platforms = input.platforms ?? PLATFORMS_DEFAULT;
  const topic = topicFromProject(input.project);
  setStageRunning(input.project.id, PipelineStage.METADATA, 'Writing titles, descriptions & hashtags per platform…', input.userId);

  let failed = 0;
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const spec = PLATFORM_FORMATS[platform];
    try {
      input.report?.(`${spec.label} — titles & hashtags…`);
      const res: RouterResult<GeneratedText> = await router.generateText(JSON.stringify({ topic, script, platform }), {
        system: [
          'You write publish metadata for short-form video platforms.',
          `Reply with ONLY JSON: {"platform":"${platform}","title":"<${spec.captionMaxLength} chars, hook-first>","description":"plain text with \\n line breaks","hashtags":["#..."],"thumbnailConcepts":["[Label] visual description"]}`,
          `Platform: ${spec.label}. Max caption length ${spec.captionMaxLength}. Caption style hint: ${spec.captionStyleHint}.`,
          'No markdown, JSON only.',
        ].join('\n'),
        jsonMode: true,
        mockTask: 'metadata' as const,
        mockPayload: { topic, angleTitle: angle?.title, angleHook: angle?.hook, scriptTitle: (latest.script as any)?.title ?? undefined, platform, seed: `${latest.id}|${platform}` },
      }, { userId: input.userId });
      const parsed = parseJsonObject(res.data.text, 'metadata');
      const version = (metadataRepo.latestFor(input.project.id, platform)?.version ?? 0) + 1;
      metadataRepo.insert({
        id: makeId('meta'),
        projectId: input.project.id,
        platform,
        version,
        prompt: `metadata ${platform} v${version}`,
        provider: res.providerId,
        payload: parsed,
      });
    } catch (e) {
      failed++;
      logger.warn(`Metadata generation for ${platform} failed`, e);
    }
  }
  if (failed === platforms.length) {
    setStageError(input.project.id, PipelineStage.METADATA, 'Metadata generation failed for every platform — try again.', input.userId);
    throw new AppError({ code: 'PROVIDER_UNAVAILABLE', userMessage: 'Metadata generation failed for every platform.', suggestion: 'Try again or add a provider key.' });
  }
  setStageReady(input.project.id, PipelineStage.METADATA, `${platforms.length - failed} of ${platforms.length} platforms ready — titles, descriptions, hashtags & thumbnail concepts.`, input.userId);
}

// ---------------------------------------------------------------------------
// Stage 4 — assembly orchestration
// ---------------------------------------------------------------------------

export async function assembleProjectVideo(input: { project: ProjectRow; userId?: string; report?: (pct: number, text: string) => void }): Promise<{ assetId: string; durationSec: number; provider: string }> {
  const latest = scriptRepo.latest(input.project.id);
  if (!latest) throw AppError.badRequest('No script yet — nothing to assemble.');
  const scenes = parseScenes(latest.script);
  if (!scenes.length) throw AppError.badRequest('Script has no scenes.');
  const style = await (await import('./assets')).styleForProject(input.project);

  setStageRunning(input.project.id, PipelineStage.ASSEMBLY, 'Stitching scenes, captions & voiceover…', input.userId);

  // collect current media for each scene
  const currentOf = (a: { id: string; current_version_id: string | null } | undefined) =>
    a?.current_version_id ? assetRepo.versions(a.id).find((v) => v.id === a.current_version_id) : undefined;

  const media: Array<{ imageKey: string; audioKey: string | null; caption: string; durationSec: number; captionColor: string }> = [];
  for (const scene of scenes) {
    const img = assetRepo.byScene(input.project.id, scene.id, AssetType.IMAGE);
    const aud = assetRepo.byScene(input.project.id, scene.id, AssetType.AUDIO);
    const imgVer = currentOf(img);
    if (!img || !imgVer?.object_key) {
      setStageError(input.project.id, PipelineStage.ASSEMBLY, `Scene ${scene.id} has no visual yet — generate assets first.`, input.userId);
      throw AppError.badRequest(`Scene ${scene.id} has no visual yet.`, 'Generate assets in the previous step, then assemble again.');
    }
    const audVer = currentOf(aud);
    if (!imgVer.object_key || !objectStore().exists(imgVer.object_key)) {
      setStageError(input.project.id, PipelineStage.ASSEMBLY, `Scene ${scene.id} visual is missing its file — regenerate it.`, input.userId);
      throw AppError.badRequest(`Scene ${scene.id} visual file is missing.`, 'Regenerate the scene image.');
    }
    media.push({
      imageKey: imgVer.object_key,
      audioKey: audVer?.object_key && objectStore().exists(audVer.object_key) ? audVer.object_key : null,
      caption: scene.on_screen_text || '',
      durationSec: scene.duration_sec,
      captionColor: style?.swatches?.[3] ?? '#1f8a70',
    });
  }

  // ensure music asset exists (best-effort)
  await ensureMusicAsset(input.project, { userId: input.userId });

  const fs = await import('node:fs');
  const tmp = (await import('../config')).paths.tmpDir;
  const runId = makeId('asm', 8);
  const localImages: string[] = [];
  const localAudios: string[] = [];
  const readToTemp = (key: string, suffix: string): string => {
    const data = objectStore().get(key);
    if (!data) throw AppError.internal(`Storage read failed for ${key}.`, 'Regenerate the asset and try again.');
    const p = `${tmp}/${runId}_${suffix}`;
    fs.writeFileSync(p, data);
    return p;
  };
  media.forEach((m, i) => {
    localImages.push(readToTemp(m.imageKey, `s${i}.png`));
    if (m.audioKey) localAudios.push(readToTemp(m.audioKey, `a${i}.wav`));
  });

  const musicAsset = assetRepo.forProject(input.project.id).find((a) => a.type === AssetType.MUSIC && !a.scene_id);
  let musicPath: string | null = null;
  if (musicAsset?.current_version_id) {
    const v = assetRepo.versions(musicAsset.id).find((x) => x.id === musicAsset.current_version_id);
    if (v?.object_key && objectStore().exists(v.object_key)) {
      musicPath = readToTemp(v.object_key, 'music.wav');
    }
  }

  const outPath = `${tmp}/${runId}_final.mp4`;
  const { assembleSlideshow } = await import('../ffmpeg');
  const out = await assembleSlideshow({
    scenes: media.map((m, i) => ({
      imagePath: localImages[i],
      audioPath: localAudios[i] ?? null,
      caption: m.caption,
      durationSec: m.durationSec,
      captionColor: m.captionColor,
    })),
    musicPath,
    outPath,
    onProgress: (pct, text) => input.report?.(pct, text),
  });

  const buffer = fs.readFileSync(outPath);
  // cleanup intermediates
  for (const p of [...localImages, ...localAudios, ...(musicPath ? [musicPath] : []), outPath]) {
    try { fs.rmSync(p, { force: true }); } catch { /* best effort */ }
  }

  const assetInfo = ensureCompositeAsset(input.project.id);
  const compositeAsset = assetInfo.asset;
  const { objectStore: store } = await import('../storage');
  const { newObjectKey } = await import('../storage');
  const key = newObjectKey('mp4');
  await store().put(key, buffer, 'video/mp4');
  const version = assetRepo.nextVersion(compositeAsset.id);
  const versionId = makeId('av');
  assetRepo.insertVersion({
    id: versionId,
    assetId: compositeAsset.id,
    version,
    status: 'ready',
    objectKey: key,
    contentType: 'video/mp4',
    payload: { scenes: scenes.length, scriptVersion: latest.version },
    prompt: 'assembled slideshow',
    provider: 'ffmpeg',
    durationSec: out.durationSec,
    width: 720,
    height: 1280,
  });
  assetRepo.update(compositeAsset.id, { status: 'ready', current_version_id: versionId });
  setStageReady(input.project.id, PipelineStage.ASSEMBLY, `Video ready — ${scenes.length} scenes, ~${Math.round(out.durationSec)}s (slideshow path).`, input.userId);
  return { assetId: compositeAsset.id, durationSec: out.durationSec, provider: 'ffmpeg' };
}

function ensureCompositeAsset(projectId: string): { asset: any; created: boolean } {
  const existing = assetRepo.forProject(projectId).find((a) => a.type === AssetType.COMPOSITE && !a.scene_id);
  if (existing) return { asset: existing, created: false };
  const id = makeId('ast');
  assetRepo.create({ id, projectId, type: AssetType.COMPOSITE, label: 'Final video' });
  const row = assetRepo.forProject(projectId).find((a) => a.id === id)!;
  return { asset: row, created: true };
}

// ---------------------------------------------------------------------------
// Auto-run chain: ideation → script → assets → assembly → metadata
// ---------------------------------------------------------------------------

export async function runPipelineUntil(input: { project: ProjectRow; targetStage: PipelineStage; userId?: string; report: (stage: string, pct: number, text: string) => void }): Promise<void> {
  const { project, targetStage, report } = input;
  const order: PipelineStage[] = [PipelineStage.IDEATION, PipelineStage.SCRIPT, PipelineStage.ASSETS, PipelineStage.ASSEMBLY, PipelineStage.METADATA, PipelineStage.REVIEW];
  const targetIdx = order.indexOf(targetStage);

  // Stage 1 ideation: ensure an idea exists (use stored prompt or generate)
  const idea = readIdea(project);
  if (!idea?.angles?.length) {
    report(PipelineStage.IDEATION, 20, 'Expanding your idea into angles…');
    const out = await generateIdeation({ project, userId: input.userId });
    projectRepo.update(project.id, { idea: out.idea });
    project.idea = JSON.stringify(out.idea);
    projectRepo.touch(project.id);
  }
  report(PipelineStage.IDEATION, 100, 'Idea ready — pick an angle to continue.');
  if (order.indexOf(PipelineStage.IDEATION) >= targetIdx) { setStageReady(project.id, PipelineStage.IDEATION, 'Idea expanded into angles.', input.userId); return; }

  // Stage 2 script
  if (!scriptRepo.latest(project.id)) {
    report(PipelineStage.SCRIPT, 15, 'Breaking your idea into scenes…');
    await generateScript({ project, userId: input.userId });
  }
  setStageReady(project.id, PipelineStage.SCRIPT, 'Scene breakdown ready.', input.userId);
  if (order.indexOf(PipelineStage.SCRIPT) >= targetIdx) return;

  // Stage 3 assets
  await runAssetsStage({
    project,
    userId: input.userId,
    report: (pct, text) => report(PipelineStage.ASSETS, pct, text),
  });
  if (order.indexOf(PipelineStage.ASSETS) >= targetIdx) return;

  // Stage 4 assembly
  await assembleProjectVideo({
    project,
    userId: input.userId,
    report: (pct, text) => report(PipelineStage.ASSEMBLY, pct, text),
  });
  if (order.indexOf(PipelineStage.ASSEMBLY) >= targetIdx) return;

  // Stage 5 metadata
  await generateMetadataForProject({
    project,
    userId: input.userId,
    report: (text) => report(PipelineStage.METADATA, 0, text),
  });
  if (order.indexOf(PipelineStage.METADATA) >= targetIdx) return;

  setStageReady(project.id, PipelineStage.REVIEW, 'Ready for review — tweak any scene, asset or caption, then publish.', input.userId);
}

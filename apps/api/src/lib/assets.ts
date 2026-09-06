// Scene asset generation + versioned asset model (Stages 3 & 6 support).
import { AssetType, PipelineStage } from '@cas/shared';
import { Modality } from '@cas/shared';
import type { Scene } from '@cas/shared';
import { AppError } from '../errors';
import { logger } from '../logger';
import { assetRepo, projectRepo, scriptRepo, styleRepo, type ProjectRow } from '../db/repos';
import { objectStore, newObjectKey } from '../storage';
import { router } from '../providers/router';
import { makeId } from '../util';
import { setStage } from '../stage';

export interface StyleInfo {
  visualStyle: string;
  captionStyle: string;
  tone: string;
  paletteKey: string | null;
  swatches: string[];
}

const BUILTIN_PALETTE_KEYS: Record<string, string> = {
  'preset_studio-teal': 'teal',
  'preset_sunset-pop': 'sunset',
  'preset_aurora': 'aurora',
  'preset_studio-noir': 'mono',
  'preset_candy-pop': 'candy',
};

export async function styleForProject(project: ProjectRow): Promise<StyleInfo | null> {
  if (!project.style_preset_id) return null;
  const row = styleRepo.findById(project.style_preset_id);
  if (!row) return null;
  let swatches: string[] = [];
  try {
    swatches = JSON.parse(row.swatches) as string[];
  } catch {
    swatches = [];
  }
  return {
    visualStyle: row.visual_style,
    captionStyle: row.caption_style,
    tone: row.tone,
    paletteKey: BUILTIN_PALETTE_KEYS[row.id] ?? null,
    swatches,
  };
}

export function promptForScene(scene: Scene, style: StyleInfo | null, extra = ''): string {
  const styleSuffix = style
    ? `\n\nVisual style: ${style.visualStyle}. Color palette: ${style.swatches.join(', ')}. Caption style: ${style.captionStyle}. Tone: ${style.tone}.`
    : '';
  return `${scene.visual_description}${styleSuffix}${extra ? `\nExtra direction: ${extra}` : ''}`.trim();
}

type AssetRowShape = ReturnType<typeof assetRepo.forProject>[number];

// ensure asset row exists for (project, scene, type)
export function ensureAssetRow(input: {
  projectId: string;
  sceneId?: string | null;
  type: AssetType;
  label: string;
  stylePresetId?: string | null;
}): { asset: AssetRowShape; created: boolean } {
  const existing = input.sceneId
    ? assetRepo.byScene(input.projectId, input.sceneId, input.type)
    : assetRepo.forProject(input.projectId).find((a) => a.type === input.type && !a.scene_id);
  if (existing) return { asset: existing, created: false };
  const id = makeId('ast');
  assetRepo.create({
    id,
    projectId: input.projectId,
    sceneId: input.sceneId,
    type: input.type,
    label: input.label,
    stylePresetId: input.stylePresetId,
  });
  const row = assetRepo.forProject(input.projectId).find((a) => a.id === id)!;
  return { asset: row, created: true };
}

interface StorePayload {
  buffer?: Buffer;
  contentType: string;
  payload?: unknown;
  prompt?: string | null;
  provider?: string | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  ext?: string;
}

function storeVersionAndSetCurrent(assetId: string, input: StorePayload): void {
  const version = assetRepo.nextVersion(assetId);
  const objectKey = input.buffer ? newObjectKey(input.ext ?? 'bin') : null;
  if (input.buffer && objectKey) {
    objectStore().put(objectKey, input.buffer, input.contentType);
  }
  const versionId = makeId('av');
  assetRepo.insertVersion({
    id: versionId,
    assetId,
    version,
    status: 'ready',
    objectKey,
    contentType: input.buffer ? input.contentType : null,
    payload: input.payload,
    prompt: input.prompt,
    provider: input.provider,
    durationSec: input.durationSec,
    width: input.width,
    height: input.height,
  });
  assetRepo.update(assetId, { status: 'ready', current_version_id: versionId });
}

export async function generateSceneAssets(input: {
  project: ProjectRow;
  scene: Scene;
  sceneIndex: number;
  sceneCount: number;
  regenerate: boolean;
  userId?: string;
}): Promise<{ imageProvider: string; audioProvider: string; videoUsed: boolean }> {
  const { project, scene } = input;
  const style = await styleForProject(project);
  const version = scriptRepo.latest(project.id)?.version ?? 1;
  const salt = input.regenerate ? `${Date.now()}` : '';
  const seedBase = `${project.id}|v${version}|${scene.id}|${salt}`;

  // --- IMAGE ---------------------------------------------------------------
  const { asset: imageAsset } = ensureAssetRow({
    projectId: project.id,
    sceneId: scene.id,
    type: AssetType.IMAGE,
    label: `Scene image ${scene.id}`,
    stylePresetId: project.style_preset_id,
  });
  let imageProvider = 'none';
  if (input.regenerate || imageAsset.current_version_id == null) {
    assetRepo.update(imageAsset.id, { status: 'processing' });
    const prompt = promptForScene(scene, style);
    const res = await router.generateImage(
      prompt,
      {
        width: 720,
        height: 1280,
        styleParams: style ? { visualStyle: style.visualStyle, paletteKey: style.paletteKey ?? '' } : {},
        seed: seedBase,
        mockPayload: {
          paletteKey: style?.paletteKey ?? undefined,
          colors: style?.paletteKey ? undefined : style?.swatches,
          variant: input.sceneIndex,
        },
      },
      { userId: input.userId },
    );
    storeVersionAndSetCurrent(imageAsset.id, {
      buffer: res.data.buffer,
      contentType: res.data.contentType ?? 'image/png',
      prompt,
      provider: res.data.provider,
      width: res.data.width ?? undefined,
      height: res.data.height ?? undefined,
      ext: (res.data.contentType ?? '').includes('jpeg') ? 'jpg' : 'png',
    });
    imageProvider = res.data.provider;
  } else {
    imageProvider = 'cached';
  }

  // --- VOICEOVER -------------------------------------------------------------
  const { asset: audioAsset } = ensureAssetRow({
    projectId: project.id,
    sceneId: scene.id,
    type: AssetType.AUDIO,
    label: `Voiceover ${scene.id}`,
  });
  let audioProvider = 'none';
  const targetSec = Math.max(2, scene.duration_sec - 0.5);
  if (input.regenerate || audioAsset.current_version_id == null) {
    assetRepo.update(audioAsset.id, { status: 'processing' });
    const res = await router.generateSpeech(
      scene.voiceover,
      { voice: 'en-us', maxSec: targetSec },
      { userId: input.userId },
    );
    storeVersionAndSetCurrent(audioAsset.id, {
      buffer: res.data.buffer,
      contentType: res.data.contentType ?? 'audio/wav',
      prompt: scene.voiceover,
      provider: res.data.provider,
      durationSec: res.data.durationSec,
      ext: 'wav',
    });
    audioProvider = res.data.provider;
  } else {
    audioProvider = 'cached';
  }

  // --- TRUE VIDEO (capability check for video-first mode) ---------------------
  let videoUsed = false;
  if (project.video_mode === 'video-first') {
    if (router.hasCapability(Modality.VIDEO)) videoUsed = true;
    else logger.info(`video-first requested but no enabled video provider — slideshow fallback for ${project.id}`);
  }
  return { imageProvider, audioProvider, videoUsed };
}

export async function regenerateAsset(input: {
  projectId: string;
  assetId: string;
  userId?: string;
}): Promise<void> {
  const asset = assetRepo.findById(input.assetId, input.projectId);
  if (!asset) throw AppError.notFound('Asset not found.');
  if (asset.scene_id) {
    const version = scriptRepo.latest(input.projectId);
    const scenes = version ? parseScenes(version.script) : [];
    const scene = scenes.find((s) => s.id === asset.scene_id);
    if (!scene) throw AppError.badRequest('This asset belongs to a scene that no longer exists — regenerate the script first.');
    const project = projectRepo.find(input.projectId, input.userId ?? '');
    if (!project) throw AppError.notFound('Project not found.');
    const idx = Math.max(0, scenes.findIndex((s) => s.id === scene.id));
    await generateSceneAssets({
      project,
      scene,
      sceneIndex: idx,
      sceneCount: scenes.length,
      regenerate: true,
      userId: input.userId,
    });
    return;
  }
  if (asset.type === AssetType.MUSIC) {
    const project = projectRepo.find(input.projectId, input.userId ?? '');
    if (!project) throw AppError.notFound('Project not found.');
    await ensureMusicAsset(project, { regenerate: true, userId: input.userId });
    return;
  }
  throw AppError.badRequest('This asset type cannot be regenerated from here yet.');
}

export function parseScenes(scriptJson: string): Scene[] {
  try {
    const parsed = JSON.parse(scriptJson) as { scenes?: Scene[] } | Scene[];
    const scenes = Array.isArray(parsed) ? parsed : parsed.scenes;
    return Array.isArray(scenes) ? scenes : [];
  } catch {
    return [];
  }
}

/** Whole-stage asset generation: iterate the latest script's scenes. */
export async function runAssetsStage(input: {
  project: ProjectRow;
  regenerate?: boolean;
  userId?: string;
  report: (pct: number, text: string) => void;
}): Promise<void> {
  const { project } = input;
  const latest = scriptRepo.latest(project.id);
  if (!latest) throw AppError.badRequest('Write the script first — there are no scenes to visualize yet.');
  const scenes = parseScenes(latest.script);
  if (!scenes.length) throw AppError.badRequest('The script has no scenes. Regenerate it.');
  setStage(project.id, PipelineStage.ASSETS, 'running', { progress: 2, statusText: 'Preparing scene assets…', userId: input.userId });

  for (let i = 0; i < scenes.length; i++) {
    input.report(5 + Math.round((i / scenes.length) * 85), `Scene ${i + 1}/${scenes.length} — visuals + voiceover…`);
    try {
      await generateSceneAssets({
        project,
        scene: scenes[i],
        sceneIndex: i,
        sceneCount: scenes.length,
        regenerate: input.regenerate === true,
        userId: input.userId,
      });
    } catch (e) {
      const err = e instanceof AppError ? e : AppError.internal('Asset generation failed.', e);
      setStage(project.id, PipelineStage.ASSETS, 'error', {
        statusText: `Scene ${i + 1} of ${scenes.length} could not be generated: ${err.userMessage} ${err.suggestion ?? ''}`,
        userId: input.userId,
      });
      throw err;
    }
  }

  const totalSec = scenes.reduce((s, sc) => s + sc.duration_sec, 0);
  input.report(93, 'Composing background music…');
  await ensureMusicAsset(project, { userId: input.userId, durationSec: totalSec });

  input.report(100, `${scenes.length} scenes ready — images + voiceover (slideshow path)`);
  setStage(project.id, PipelineStage.ASSETS, 'ready', {
    progress: 100,
    statusText:
      `${scenes.length} scenes ready — images + voiceover. ` +
      (router.hasCapability(Modality.VIDEO) ? 'Video generation available.' : 'Video generation not enabled, so assembly uses the slideshow path.'),
    userId: input.userId,
  });
}

export async function ensureMusicAsset(
  project: ProjectRow,
  opts: { regenerate?: boolean; userId?: string; durationSec?: number } = {},
): Promise<void> {
  const { asset } = ensureAssetRow({ projectId: project.id, type: AssetType.MUSIC, label: 'Background music' });
  const needs = opts.regenerate || asset.current_version_id == null;
  if (!needs) return;
  const latest = scriptRepo.latest(project.id);
  const scenes = latest ? parseScenes(latest.script) : [];
  const total = opts.durationSec ?? scenes.reduce((s, sc) => s + sc.duration_sec, 28);
  assetRepo.update(asset.id, { status: 'processing' });
  const { composeAmbientPad } = await import('../ffmpeg');
  const { paths } = await import('../config');
  const fs = await import('node:fs');
  const outPath = `${paths.tmpDir}/music_${project.id}_${Date.now()}.wav`;
  const made = await composeAmbientPad(`${project.id}|${latest?.version ?? 1}`, total + 0.5, outPath);
  if (!made || !fs.existsSync(outPath)) {
    // degrade silently; assembly continues without music
    assetRepo.update(asset.id, { status: 'ready' });
    return;
  }
  const buffer = fs.readFileSync(outPath);
  fs.rmSync(outPath, { force: true });
  storeVersionAndSetCurrent(asset.id, {
    buffer,
    contentType: 'audio/wav',
    prompt: 'Ambient background music bed',
    provider: 'ffmpeg-synth',
    durationSec: total + 0.5,
    ext: 'wav',
  });
}

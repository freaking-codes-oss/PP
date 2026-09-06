// Job handlers — each queue job type maps to a pipeline action. Progress is
// written to the DB (project_stages / assets) and broadcast over SSE.
import { AssetType, PipelineStage, PlatformId } from '@cas/shared';
import type { JobHandler } from '../queue';
import { assetRepo, projectRepo, scriptRepo } from '../db/repos';
import { AppError } from '../errors';
import { generateSceneAssets, parseScenes, ensureMusicAsset } from '../lib/assets';
import { assembleProjectVideo, generateMetadataForProject, runPipelineUntil } from '../lib/pipeline';
import { executePublish } from '../publishing';
import { scanTrends } from '../lib/trends';
import { syncAnalyticsForUser } from '../lib/analytics';
import { setStageError, setStage } from '../stage';
import { logger } from '../logger';

const uid = (data: Record<string, unknown>): string | undefined =>
  typeof data.userId === 'string' ? data.userId : undefined;

export const handlers: Record<string, JobHandler> = {
  'generate-scene-assets': async (ctx) => {
    const { projectId, sceneId, regenerate } = ctx.data;
    const userId = uid(ctx.data);
    const project = projectRepo.find(String(projectId), userId ?? '');
    if (!project) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Project not found.' });
    const latest = scriptRepo.latest(project.id);
    const scenes = latest ? parseScenes(latest.script) : [];
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) {
      // script changed under us — nothing to do for a stale scene id
      return;
    }
    const idx = Math.max(0, scenes.findIndex((s) => s.id === sceneId));
    ctx.progress(10, `Scene ${idx + 1}/${scenes.length}`);
    const out = await generateSceneAssets({
      project,
      scene,
      sceneIndex: idx,
      sceneCount: scenes.length,
      regenerate: regenerate === true,
      userId,
    });
    ctx.log(`scene ${scene.id} assets ok (${out.imageProvider}/${out.audioProvider})`);
  },

  'assets-verify': async (ctx) => {
    const userId = uid(ctx.data);
    const project = projectRepo.find(String(ctx.data.projectId), userId ?? '');
    if (!project) return;
    const latest = scriptRepo.latest(project.id);
    const scenes = latest ? parseScenes(latest.script) : [];
    const missing: string[] = [];
    for (const scene of scenes) {
      const img = assetRepo.byScene(project.id, scene.id, AssetType.IMAGE);
      const aud = assetRepo.byScene(project.id, scene.id, AssetType.AUDIO);
      if (!img?.current_version_id || !aud?.current_version_id) missing.push(scene.id);
      else {
        const iv = assetRepo.versions(img.id).find((v) => v.id === img.current_version_id);
        if (!iv || iv.status !== 'ready') missing.push(scene.id);
      }
    }
    if (missing.length === 0) {
      setStage(project.id, PipelineStage.ASSETS, 'ready', {
        progress: 100,
        statusText: `${scenes.length} scenes ready — images + voiceover. Video generation not enabled, so assembly uses the slideshow path.`,
        userId,
      });
    } else {
      setStageError(
        project.id,
        PipelineStage.ASSETS,
        `${missing.length} scene${missing.length > 1 ? 's' : ''} still missing assets (${missing.join(', ')}) — one may have failed; regenerate it.`,
        userId,
      );
    }
  },

  'generate-project-music': async (ctx) => {
    const project = projectRepo.find(String(ctx.data.projectId), uid(ctx.data) ?? '');
    if (!project) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Project not found.' });
    await ensureMusicAsset(project, { regenerate: ctx.data.regenerate === true, userId: uid(ctx.data) });
    setStage(project.id, PipelineStage.ASSETS, 'ready', {
      progress: 100,
      statusText: 'Music bed updated.',
      userId: uid(ctx.data),
    });
  },

  'assemble-video': async (ctx) => {
    const project = projectRepo.find(String(ctx.data.projectId), uid(ctx.data) ?? '');
    if (!project) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Project not found.' });
    await assembleProjectVideo({
      project,
      userId: uid(ctx.data),
      report: (pct, text) => ctx.progress(pct, text),
    });
  },

  'generate-metadata': async (ctx) => {
    const project = projectRepo.find(String(ctx.data.projectId), uid(ctx.data) ?? '');
    if (!project) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Project not found.' });
    const platforms = Array.isArray(ctx.data.platforms)
      ? (ctx.data.platforms as string[]).filter((p): p is PlatformId => Object.values(PlatformId).includes(p as PlatformId))
      : undefined;
    await generateMetadataForProject({
      project,
      platforms,
      userId: uid(ctx.data),
      report: (text) => ctx.progress(0, text),
    });
  },

  'publish': async (ctx) => {
    await executePublish({
      jobId: String(ctx.data.jobId),
      userId: uid(ctx.data) ?? '',
      report: (pct, text) => ctx.progress(pct, text),
    });
  },

  'pipeline-run': async (ctx) => {
    const project = projectRepo.find(String(ctx.data.projectId), uid(ctx.data) ?? '');
    if (!project) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Project not found.' });
    const target = (ctx.data.targetStage as PipelineStage) ?? PipelineStage.REVIEW;
    try {
      await runPipelineUntil({
        project,
        targetStage: target,
        userId: uid(ctx.data),
        report: (stage, pct, text) => ctx.progress(pct, `[${stage}] ${text}`),
      });
    } catch (e) {
      const msg = e instanceof AppError ? e.userMessage : String(e);
      setStageError(project.id, target, msg, uid(ctx.data));
      throw e;
    }
  },

  'trends-scan': async () => {
    const out = await scanTrends();
    logger.info(`trend scan complete: ${out.inserted} fresh, ${out.keptManual} manual kept`);
  },

  'analytics-sync': async (ctx) => {
    const userId = uid(ctx.data);
    if (!userId) return;
    const inserted = await syncAnalyticsForUser(userId);
    logger.info(`analytics sync (${userId}): ${inserted} snapshots`);
  },
};

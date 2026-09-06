import { Router } from 'express';
import { z } from 'zod';
import {
  AssetType, PipelineStage, PlatformId, sceneSchema, STAGE_ORDER,
} from '@cas/shared';
import {
  analyticsRepo, assetRepo, metadataRepo, projectRepo, publishRepo, scriptRepo, stageRepo, styleRepo,
  type ProjectRow,
} from '../db/repos';
import { makeId } from '../util';
import { AppError } from '../errors';
import { objectStore } from '../storage';
import { queue } from '../queue';
import { generateIdeation, generateScript, readIdea } from '../lib/pipeline';
import { parseScenes } from '../lib/assets';
import { asyncRoute, ok, requireUser, type AuthedRequest } from './helpers';
import { setStage, setStageRunning } from '../stage';

const router = Router();

// small helper — recompute stage states for a project row
function stageMap(projectId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of stageRepo.forProject(projectId)) out[s.stage] = s.state;
  for (const stage of STAGE_ORDER) if (!out[stage]) out[stage] = 'not_started';
  return out;
}

function summary(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    idea: readIdea(row),
    currentStage: row.current_stage,
    stageStates: stageMap(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireProjectRow(req: AuthedRequest, projectId: string): ProjectRow {
  const user = requireUser(req);
  const project = projectRepo.find(projectId, user.id);
  if (!project) throw AppError.notFound('Project not found.');
  return project;
}

// ---------------------------------------------------------------- list/create
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const rows = projectRepo.listForUser(user.id);
    const out = rows.map((r) => {
      const s = summary(r);
      const snap = analyticsRepo.forProject(r.id, 7);
      const totals = snap.reduce(
        (acc, x) => ({ views: acc.views + x.views, likes: acc.likes + x.likes, comments: acc.comments + x.comments }),
        { views: 0, likes: 0, comments: 0 },
      );
      const published = publishRepo.forProject(r.id).filter((j) => j.status === 'published').length;
      return { ...s, totals, published };
    });
    ok(res, { projects: out });
  }),
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string().min(1).max(120), idea: z.string().max(500).optional() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Give the project a name.');
    const id = makeId('prj');
    const ideaPayload = body.data.idea ? { prompt: body.data.idea, angles: [] } : undefined;
    projectRepo.create({ id, userId: user.id, name: body.data.name, idea: ideaPayload });
    const project = projectRepo.find(id, user.id)!;
    ok(res, { project: summary(project) }, 201);
  }),
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const style = project.style_preset_id ? styleRepo.findById(project.style_preset_id) : null;
    ok(res, {
      project: { ...summary(project), stylePreset: style ? serializeStyle(style) : null, videoMode: project.video_mode },
    });
  }),
);

function serializeStyle(s: any) {
  return {
    id: s.id, name: s.name, description: s.description, builtIn: Boolean(s.built_in),
    visualStyle: s.visual_style, colorPalette: s.color_palette, captionStyle: s.caption_style,
    tone: s.tone, musicMood: s.music_mood ?? null, swatches: JSON.parse(s.swatches),
  };
}

router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        stylePresetId: z.string().nullable().optional(),
        videoMode: z.enum(['auto', 'slideshow', 'video-first']).optional(),
      })
      .safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Invalid project update.');
    projectRepo.update(project.id, {
      name: body.data.name,
      style_preset_id: body.data.stylePresetId,
      video_mode: body.data.videoMode,
    });
    const updated = projectRepo.find(project.id, requireUser(req).id)!;
    ok(res, { project: summary(updated) });
  }),
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    projectRepo.delete(project.id);
    ok(res, { deleted: project.id });
  }),
);

// ---------------------------------------------------------------- Stage 1: ideation
router.post(
  '/:id/ideation',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ prompt: z.string().min(2).max(800).optional(), trendIds: z.array(z.string()).max(10).optional() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Enter a topic or idea.');
    setStageRunning(project.id, PipelineStage.IDEATION, 'Expanding your idea into angles…', user.id);
    const trendContext = body.data.trendIds?.length
      ? (await import('../lib/trends')).trendContextByIds(body.data.trendIds)
      : [];
    const out = await generateIdeation({ project, prompt: body.data.prompt, trendContext: trendContext.map((t) => t.title), userId: user.id });
    const prev = readIdea(project);
    projectRepo.update(project.id, {
      idea: { ...out.idea, prompt: body.data.prompt ?? prev?.prompt ?? project.name, selectedAngleId: prev?.selectedAngleId ?? null },
    });
    setStage(project.id, PipelineStage.IDEATION, 'ready', { progress: 100, statusText: out.usedFallback ? 'Angles ready (used a fallback provider).' : 'Angles ready — pick the one that fits.', userId: user.id });
    projectRepo.touch(project.id);
    ok(res, { idea: readIdea(projectRepo.find(project.id, user.id)!), provider: out.provider, usedFallback: out.usedFallback });
  }),
);

router.post(
  '/:id/ideation/select-angle',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ angleId: z.string() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Choose one of the generated angles.');
    const idea = readIdea(project);
    const angles = idea?.angles ?? [];
    if (!angles.find((a: any) => a.id === body.data.angleId)) throw AppError.badRequest('That angle is not in the current idea — regenerate the angles first.');
    projectRepo.update(project.id, { idea: { ...idea, selectedAngleId: body.data.angleId } });
    projectRepo.touch(project.id);
    ok(res, { selectedAngleId: body.data.angleId });
  }),
);

// ---------------------------------------------------------------- Stage 2: script
router.post(
  '/:id/script',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ sceneCount: z.number().int().min(4).max(8).optional(), prompt: z.string().max(800).optional() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Invalid script options.');
    const idea = readIdea(project);
    if (!idea?.angles?.length) {
      // auto-ideate first (keeps the wizard moving)
      const out = await generateIdeation({ project, prompt: body.data.prompt, userId: user.id });
      projectRepo.update(project.id, { idea: { ...out.idea, prompt: body.data.prompt ?? project.name, selectedAngleId: out.idea.angles[0]?.id } });
    }
    setStageRunning(project.id, PipelineStage.SCRIPT, 'Breaking your idea into scenes…', user.id);
    const out = await generateScript({ project, sceneCount: body.data.sceneCount, userId: user.id });
    setStage(project.id, PipelineStage.SCRIPT, 'ready', { progress: 100, statusText: 'Scene breakdown ready — review or regenerate below.', userId: user.id });
    projectRepo.touch(project.id);
    ok(res, { script: out.scriptVersion.script, version: out.scriptVersion.version, provider: out.scriptVersion.provider, usedFallback: out.usedFallback });
  }),
);

router.put(
  '/:id/script/scenes',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ title: z.string().optional(), overview: z.string().optional(), scenes: z.array(sceneSchema).min(1).max(12) }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Scene data is invalid — each scene needs visual description, voiceover, on-screen text and a duration.', 'Fix the highlighted scenes and save again.');
    const version = (scriptRepo.latest(project.id)?.version ?? 0) + 1;
    const prev = scriptRepo.latest(project.id);
    const prevParsed = prev ? JSON.parse(prev.script) : {};
    const doc = {
      title: body.data.title ?? prevParsed.title ?? '',
      overview: body.data.overview ?? prevParsed.overview ?? '',
      scenes: body.data.scenes.map((s, i) => ({ ...s, id: s.id || `scene_${i + 1}` })),
    };
    scriptRepo.insert({ id: makeId('scr'), projectId: project.id, version, source: 'manual-edit', script: doc });
    setStage(project.id, PipelineStage.SCRIPT, 'ready', { progress: 100, statusText: 'Script updated manually — assets for edited scenes can be regenerated.', userId: user.id });
    // edited scenes: reset per-scene assets so review shows they are stale
    const scenes = doc.scenes;
    for (const asset of assetRepo.forProject(project.id).filter((a) => a.scene_id)) {
      const still = scenes.find((s: any) => s.id === asset.scene_id);
      if (!still && asset.type !== AssetType.COMPOSITE) {
        // scene removed — leave rows but they will simply not be used
      }
    }
    projectRepo.touch(project.id);
    ok(res, { version, script: doc });
  }),
);

router.get(
  '/:id/script',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const latest = scriptRepo.latest(project.id);
    const versions = scriptRepo.list(project.id).map((v) => ({
      id: v.id, version: v.version, source: v.source, createdAt: v.created_at,
      scenes: parseScenes(v.script), title: (JSON.parse(v.script) as any)?.title ?? null,
      overview: (JSON.parse(v.script) as any)?.overview ?? null,
    }));
    ok(res, {
      latest: latest
        ? {
            id: latest.id, version: latest.version, source: latest.source, createdAt: latest.created_at,
            scenes: parseScenes(latest.script), title: (JSON.parse(latest.script) as any)?.title ?? '',
            overview: (JSON.parse(latest.script) as any)?.overview ?? '',
          }
        : null,
      versions,
    });
  }),
);

// ---------------------------------------------------------------- Stage 3: assets
router.get(
  '/:id/assets',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const rows = assetRepo.forProject(project.id);
    const assets = rows.map((a) => {
      const versions = assetRepo.versions(a.id);
      const current = versions.find((v) => v.id === a.current_version_id) ?? versions[0];
      return {
        id: a.id,
        sceneId: a.scene_id,
        type: a.type,
        label: a.label,
        status: a.status,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        currentVersion: current
          ? {
              id: current.id,
              version: current.version,
              status: current.status,
              contentType: current.content_type,
              durationSec: current.duration_sec,
              width: current.width,
              height: current.height,
              provider: current.provider,
              prompt: current.prompt,
              error: current.error,
              createdAt: current.created_at,
            }
          : null,
        versions: versions.map((v) => ({
          id: v.id, version: v.version, status: v.status, provider: v.provider,
          contentType: v.content_type, createdAt: v.created_at, durationSec: v.duration_sec,
        })),
        versionCount: versions.length,
      };
    });
    ok(res, { assets });
  }),
);

// Generate missing assets for every scene (auto-runs idea/script if needed)
router.post(
  '/:id/assets/generate',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ regenerate: z.enum(['missing', 'all']).default('missing') }).safeParse(req.body);
    const q = queue();
    if (body.success && body.data.regenerate === 'all') {
      const latest = scriptRepo.latest(project.id);
      const scenes = latest ? parseScenes(latest.script) : [];
      if (!scenes.length) throw AppError.badRequest('No script yet — generate the script first.');
      setStageRunning(project.id, PipelineStage.ASSETS, 'Regenerating all scene assets…', user.id);
      for (const scene of scenes) {
        await q.enqueue('generate-scene-assets', { projectId: project.id, sceneId: scene.id, regenerate: true, userId: user.id });
      }
      await q.enqueue('assets-verify', { projectId: project.id, userId: user.id });
      ok(res, { queued: scenes.length, mode: 'all' }, 202);
      return;
    }
    await q.enqueue('pipeline-run', { projectId: project.id, targetStage: PipelineStage.ASSETS, userId: user.id });
    ok(res, { queued: true, mode: 'missing' }, 202);
  }),
);

router.post(
  '/:id/assets/:assetId/regenerate',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const asset = assetRepo.findById(req.params.assetId, project.id);
    if (!asset) throw AppError.notFound('Asset not found.');
    const q = queue();
    if (asset.scene_id) {
      await q.enqueue('generate-scene-assets', { projectId: project.id, sceneId: asset.scene_id, regenerate: true, userId: user.id });
      await q.enqueue('assets-verify', { projectId: project.id, userId: user.id });
    } else if (asset.type === AssetType.MUSIC) {
      await q.enqueue('generate-project-music', { projectId: project.id, regenerate: true, userId: user.id });
    } else {
      throw AppError.badRequest('This asset cannot be regenerated from here.');
    }
    ok(res, { queued: true }, 202);
  }),
);

router.post(
  '/:id/versions/:assetId/revert',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const asset = assetRepo.findById(req.params.assetId, project.id);
    if (!asset) throw AppError.notFound('Asset not found.');
    const body = z.object({ versionId: z.string() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Choose a version to revert to.');
    const version = assetRepo.versionById(body.data.versionId);
    if (!version || version.asset_id !== asset.id) throw AppError.badRequest('That version does not belong to this asset.');
    assetRepo.update(asset.id, { status: 'ready', current_version_id: version.id });
    ok(res, { revertedTo: version.id });
  }),
);

router.get(
  '/:id/assets/:assetId/file',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const asset = assetRepo.findById(req.params.assetId, project.id);
    if (!asset) throw AppError.notFound('Asset not found.');
    const version = assetRepo.versionById(String(req.query.versionId ?? asset.current_version_id ?? ''));
    if (!version || version.asset_id !== asset.id || !version.object_key) throw AppError.notFound('No file for this asset version yet.');
    const data = await objectStore().get(version.object_key);
    if (!data) throw AppError.notFound('File missing from storage — regenerate this asset.');
    res.setHeader('content-type', version.content_type ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=60');
    res.send(data);
  }),
);

// ---------------------------------------------------------------- Stage 4: assembly
router.post(
  '/:id/assemble',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const latest = scriptRepo.latest(project.id);
    const scenes = latest ? parseScenes(latest.script) : [];
    for (const scene of scenes) {
      const img = assetRepo.byScene(project.id, scene.id, AssetType.IMAGE);
      if (!img?.current_version_id) {
        throw AppError.badRequest(`Scene ${scene.id} has no visual yet.`, 'Generate scene assets first, then assemble.');
      }
    }
    await queue().enqueue('assemble-video', { projectId: project.id, userId: user.id });
    ok(res, { queued: true }, 202);
  }),
);

// ---------------------------------------------------------------- Stage 5: metadata
router.get(
  '/:id/metadata',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const rows = metadataRepo.latest(project.id).map((m) => ({
      platform: m.platform,
      version: m.version,
      createdAt: m.created_at,
      ...JSON.parse(m.payload),
    }));
    ok(res, { metadata: rows });
  }),
);

router.post(
  '/:id/metadata',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ platforms: z.array(z.nativeEnum(PlatformId)).optional() }).safeParse(req.body);
    if (!scriptRepo.latest(project.id)) throw AppError.badRequest('Generate the script first — metadata describes the finished video.');
    await queue().enqueue('generate-metadata', { projectId: project.id, platforms: body.success ? body.data.platforms : undefined, userId: user.id });
    ok(res, { queued: true }, 202);
  }),
);

// ---------------------------------------------------------------- publish-related lists
router.get(
  '/:id/publish-jobs',
  asyncRoute(async (req, res) => {
    const project = requireProjectRow(req, req.params.id);
    const jobs = publishRepo.forProject(project.id).map((j) => ({
      id: j.id,
      platform: j.platform,
      status: j.status,
      mode: j.mode,
      attempts: j.attempts,
      maxAttempts: j.max_attempts,
      platformVideoId: j.platform_video_id,
      platformUrl: j.platform_url,
      lastError: j.last_error,
      scheduledFor: j.scheduled_for,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
    }));
    ok(res, { jobs });
  }),
);

router.post(
  '/:id/publish',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z
      .object({
        platform: z.nativeEnum(PlatformId),
        mode: z.enum(['draft', 'auto']).default('auto'),
        scheduledFor: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Choose a platform to publish to.');
    const composite = assetRepo.forProject(project.id).find((a) => a.type === AssetType.COMPOSITE && !a.scene_id);
    if (!composite?.current_version_id) {
      throw AppError.badRequest('Assemble the video first — there is nothing to publish yet.', 'Run the assemble step, then publish again.');
    }
    const { publishJobFromProject } = await import('../publishing');
    const { jobId } = publishJobFromProject({
      project, platform: body.data.platform, mode: body.data.mode,
      scheduledFor: body.data.scheduledFor ?? null, userId: user.id,
    });
    const delayMs = body.data.scheduledFor ? Math.max(0, new Date(body.data.scheduledFor).getTime() - Date.now()) : 0;
    await queue().enqueue('publish', { jobId, userId: user.id }, { delayMs });
    ok(res, { jobId }, 202);
  }),
);

router.post(
  '/:id/publish-jobs/:jobId/retry',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const job = publishRepo.byId(req.params.jobId, user.id);
    if (!job || job.project_id !== project.id) throw AppError.notFound('Publish job not found.');
    publishRepo.update(job.id, { status: 'queued', last_error: null, attempts: 0 });
    await queue().enqueue('publish', { jobId: job.id, userId: user.id });
    ok(res, { queued: true }, 202);
  }),
);

// ---------------------------------------------------------------- auto-run wizard chain
router.post(
  '/:id/run',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    const body = z.object({ targetStage: z.nativeEnum(PipelineStage).optional() }).safeParse(req.body);
    const target = body.success ? body.data.targetStage : undefined;
    await queue().enqueue('pipeline-run', { projectId: project.id, targetStage: target ?? PipelineStage.REVIEW, userId: user.id });
    ok(res, { queued: true, targetStage: target ?? PipelineStage.REVIEW }, 202);
  }),
);

// ---------------------------------------------------------------- stage events (SSE)
router.get(
  '/:id/events',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = requireProjectRow(req, req.params.id);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'hello', projectId: project.id });
    const { subscribe } = await import('../events');
    const unsub = subscribe(user.id, (ev) => {
      if (ev.projectId === project.id) send(ev);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      unsub();
      res.end();
    });
  }),
);

export default router;

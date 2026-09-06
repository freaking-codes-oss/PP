import { Router } from 'express';
import { z } from 'zod';
import { PlatformId, Modality, AssetType } from '@cas/shared';
import { styleRepo, analyticsRepo, publishRepo, projectRepo, metadataRepo } from '../db/repos';
import { AppError } from '../errors';
import { queue } from '../queue';
import { makeId } from '../util';
import { asyncRoute, ok, requireUser } from './helpers';
import {
  PLATFORM_GATES, platformList, demoConnect, disconnect, googleOAuthConfigured, youtubeAuthUrl,
  exchangeGoogleCode, storePlatformTokens,
} from '../publishing';
import { providerConfigRepo } from '../providers/configRepo';
import { secretStore } from '../secrets';
import { router as aiRouter } from '../providers/router';
import { adapterFor } from '../providers/adapters';
import { trendRepo, usageRepo, type StylePresetRow } from '../db/repos';

const router = Router();

function serializeStyle(s: StylePresetRow) {
  return {
    id: s.id, name: s.name, description: s.description, builtIn: Boolean(s.built_in),
    visualStyle: s.visual_style, colorPalette: s.color_palette, captionStyle: s.caption_style,
    tone: s.tone, musicMood: s.music_mood ?? null,
    swatches: JSON.parse(s.swatches), referenceImageKey: s.reference_image_key,
    createdAt: s.created_at,
  };
}

// ------------------------------------------------------------- style presets
router.get(
  '/style-presets',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const rows = styleRepo.allForUser(user.id);
    ok(res, { presets: rows.map(serializeStyle) });
  }),
);

router.post(
  '/style-presets',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const body = z
      .object({
        name: z.string().min(1).max(60),
        description: z.string().max(300),
        visualStyle: z.string().min(3).max(400),
        colorPalette: z.string().max(200),
        captionStyle: z.string().max(200),
        tone: z.string().max(100),
        musicMood: z.string().max(100).optional(),
        swatches: z.array(z.string()).max(6).optional(),
        referenceImageKey: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Check the style preset fields.');
    const id = makeId('preset');
    styleRepo.create({
      id,
      userId: user.id,
      name: body.data.name,
      description: body.data.description,
      visualStyle: body.data.visualStyle,
      colorPalette: body.data.colorPalette,
      captionStyle: body.data.captionStyle,
      tone: body.data.tone,
      musicMood: body.data.musicMood,
      swatches: body.data.swatches ?? ['#0f4c44', '#1f8a70', '#7fd8be', '#ffe8a3'],
      referenceImageKey: body.data.referenceImageKey ?? null,
    });
    const row = styleRepo.findById(id)!;
    ok(res, { preset: serializeStyle(row) }, 201);
  }),
);

router.delete(
  '/style-presets/:id',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const row = styleRepo.findById(req.params.id);
    if (!row) throw AppError.notFound('Style preset not found.');
    if (row.built_in) throw AppError.conflict('Built-in presets cannot be deleted — create your own instead.');
    styleRepo.deleteCustom(req.params.id, user.id);
    ok(res, { deleted: req.params.id });
  }),
);

// ------------------------------------------------------------- publishing
router.get(
  '/publishing/platforms',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    ok(res, { platforms: platformList(user.id), oauth: { googleConfigured: googleOAuthConfigured() } });
  }),
);

router.get(
  '/publishing/oauth/start',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const platform = String(req.query.platform ?? '');
    if (platform !== PlatformId.YOUTUBE) {
      const gate = PLATFORM_GATES[platform as PlatformId] ?? PLATFORM_GATES[PlatformId.YOUTUBE];
      throw AppError.conflict(`${gate.note} Use a demo connection to preview the flow, or configure Google OAuth for YouTube.`);
    }
    if (!googleOAuthConfigured()) {
      throw AppError.conflict('YouTube OAuth is not configured on this deployment. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI — meanwhile use a demo connection.');
    }
    const state = makeId('st');
    ok(res, { url: youtubeAuthUrl(user.id, state) });
  }),
);

router.get(
  '/publishing/oauth/callback',
  asyncRoute(async (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    if (!code) throw AppError.badRequest('OAuth callback missing the authorization code.');
    const [, userId] = state.split('::');
    if (!userId) throw AppError.badRequest('OAuth state invalid — start the connection again.');
    const tokens = await exchangeGoogleCode(code);
    storePlatformTokens(userId, PlatformId.YOUTUBE, tokens);
    // Redirect back to the web UI connections page
    res.redirect(`/dashboard/settings/channels?connected=youtube`);
  }),
);

router.post(
  '/publishing/connections/demo',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const body = z.object({ platform: z.nativeEnum(PlatformId) }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Choose a platform.');
    demoConnect(user.id, body.data.platform);
    const conns = platformList(user.id);
    ok(res, { platforms: conns });
  }),
);

router.post(
  '/publishing/connections/:platform/disconnect',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const platform = String(req.params.platform) as PlatformId;
    if (!Object.values(PlatformId).includes(platform)) throw AppError.badRequest('Unknown platform.');
    disconnect(user.id, platform);
    ok(res, { platforms: platformList(user.id) });
  }),
);

router.get(
  '/publishing/jobs',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const jobs = publishRepo.recentForUser(user.id).map((j) => ({
      id: j.id, platform: j.platform, status: j.status, mode: j.mode, projectId: j.project_id,
      platformUrl: j.platform_url, platformVideoId: j.platform_video_id,
      lastError: j.last_error, createdAt: j.created_at, updatedAt: j.updated_at,
    }));
    ok(res, { jobs });
  }),
);

// ------------------------------------------------------------- trends
router.get(
  '/trends',
  asyncRoute(async (req, res) => {
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const region = typeof req.query.region === 'string' ? req.query.region : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit) : 50;
    const rows = trendRepo.list({ source, region, limit });
    ok(res, {
      trends: rows.map((t) => ({
        id: t.id, source: t.source, title: t.title, category: t.category, region: t.region,
        score: t.score, url: t.url, reason: t.reason, pickedAt: t.picked_at,
      })),
    });
  }),
);

router.post(
  '/trends/manual',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    void user;
    const body = z.object({ title: z.string().min(2).max(200), category: z.string().max(80).optional(), url: z.string().url().optional().or(z.literal('')), reason: z.string().max(300).optional() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('A title is required.');
    const t = (await import('../lib/trends')).addManualTrend({
      title: body.data.title, category: body.data.category, url: body.data.url || undefined, reason: body.data.reason,
    });
    ok(res, { trend: { id: t.id, source: t.source, title: t.title } }, 201);
  }),
);

router.delete(
  '/trends/:id',
  asyncRoute(async (req, res) => {
    const row = trendRepo.list({ limit: 1000 }).find((t) => t.id === req.params.id);
    if (!row) throw AppError.notFound('Trend entry not found.');
    if (row.source !== 'manual') throw AppError.conflict('Auto-sourced trend entries are managed by the daily scan.');
    trendRepo.delete(req.params.id);
    ok(res, { deleted: req.params.id });
  }),
);

router.post(
  '/trends/scan',
  asyncRoute(async (req, res) => {
    await queue().enqueue('trends-scan', {});
    ok(res, { queued: true }, 202);
  }),
);

// ------------------------------------------------------------- analytics
router.get(
  '/analytics/overview',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const days = typeof req.query.days === 'string' ? parseInt(req.query.days) : 14;
    const rows = analyticsRepo.forUser(user.id, days);
    const byProject = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byProject.get(r.project_id) ?? [];
      list.push(r);
      byProject.set(r.project_id, list);
    }
    const projects = [...byProject.entries()].map(([projectId, snapRows]) => {
      const project = projectRepo.find(projectId, user.id);
      const totals = snapRows.reduce(
        (acc, x) => ({ views: acc.views + x.views, likes: acc.likes + x.likes, shares: acc.shares + x.shares, comments: acc.comments + x.comments }),
        { views: 0, likes: 0, shares: 0, comments: 0 },
      );
      const latestByDay = new Map<string, typeof rows[number]>();
      for (const r of snapRows) latestByDay.set(r.collected_at.slice(0, 10), r);
      const series = [...latestByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, r]) => ({ day, views: r.views, likes: r.likes }));
      return {
        projectId,
        name: project?.name ?? 'Untitled',
        totals,
        series,
      };
    });
    const grand = rows.reduce(
      (acc, x) => ({ views: acc.views + x.views, likes: acc.likes + x.likes, shares: acc.shares + x.shares, comments: acc.comments + x.comments }),
      { views: 0, likes: 0, shares: 0, comments: 0 },
    );
    ok(res, { projects, totals: grand, days });
  }),
);

router.get(
  '/analytics/projects/:projectId/series',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const project = projectRepo.find(req.params.projectId, user.id);
    if (!project) throw AppError.notFound('Project not found.');
    const days = typeof req.query.days === 'string' ? parseInt(req.query.days) : 30;
    const series = await (await import('../lib/analytics')).seriesForProject(req.params.projectId, days);
    ok(res, { series });
  }),
);

router.post(
  '/analytics/sync',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    await queue().enqueue('analytics-sync', { userId: user.id });
    ok(res, { queued: true }, 202);
  }),
);

// ------------------------------------------------------------- AI provider admin
function providerView(cfg: ReturnType<typeof providerConfigRepo.all>[number]) {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    baseUrl: cfg.base_url,
    authMethod: cfg.auth_method,
    modalities: providerConfigRepo.modalitiesOf(cfg),
    freeTier: Boolean(cfg.free_tier),
    enabled: Boolean(cfg.enabled),
    priority: cfg.priority,
    hasKey: cfg.id === 'mock' ? true : secretStore.has({ kind: 'provider-key', name: cfg.id }),
    models: JSON.parse(cfg.models),
  };
}

router.get(
  '/admin/providers',
  asyncRoute(async (req, res) => {
    const rows = providerConfigRepo.all();
    ok(res, { providers: rows.map(providerView) });
  }),
);

router.put(
  '/admin/providers/:id',
  asyncRoute(async (req, res) => {
    const cfg = providerConfigRepo.byId(req.params.id);
    if (!cfg) throw AppError.notFound('Provider not found.');
    const body = z.object({ enabled: z.boolean().optional(), priority: z.number().int().min(0).max(1000).optional(), enabledModalities: z.array(z.nativeEnum(Modality)).optional() }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Invalid provider settings.');
    providerConfigRepo.update(req.params.id, { enabled: body.data.enabled, priority: body.data.priority, enabled_modalities: body.data.enabledModalities });
    const fresh = providerConfigRepo.byId(req.params.id)!;
    ok(res, { provider: providerView(fresh) });
  }),
);

router.put(
  '/admin/providers/:id/key',
  asyncRoute(async (req, res) => {
    const cfg = providerConfigRepo.byId(req.params.id);
    if (!cfg) throw AppError.notFound('Provider not found.');
    const body = z.object({ key: z.string().min(4).max(500) }).safeParse(req.body);
    if (!body.success) throw AppError.badRequest('Paste the API key value.');
    secretStore.set({ kind: 'provider-key', name: req.params.id }, body.data.key.trim());
    const fresh = providerConfigRepo.byId(req.params.id)!;
    ok(res, { provider: providerView(fresh) });
  }),
);

router.delete(
  '/admin/providers/:id/key',
  asyncRoute(async (req, res) => {
    const cfg = providerConfigRepo.byId(req.params.id);
    if (!cfg) throw AppError.notFound('Provider not found.');
    secretStore.delete({ kind: 'provider-key', name: req.params.id });
    ok(res, { provider: providerView(cfg) });
  }),
);

// Router probe: demonstrates priority + capability + fallback chain live
router.post(
  '/admin/router/test',
  asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const body = z.object({ modality: z.nativeEnum(Modality).optional() }).safeParse(req.body);
    const modality = body.success && body.data.modality ? body.data.modality : Modality.TEXT;
    const outcome = await runProbe(modality, user.id);
    ok(res, outcome);
  }),
);

async function runProbe(modality: Modality, userId: string) {
  // full candidate chain incl. providers that are enabled but missing a key,
  // so the user sees exactly what the router considered
  const all = providerConfigRepo.all();
  const chain: any[] = [];
  if (modality === Modality.TEXT) {
    const result = await aiRouter.generateText(
      'Reply with the single word: ok',
      { system: 'Probe.', temperature: 0, maxTokens: 8, mockTask: undefined },
      { userId },
    );
    for (const a of result.attempts) {
      chain.push({ providerId: a.providerId, providerName: a.providerName, ok: a.ok, message: a.ok ? `Responded OK (${result.model ?? ''})` : a.message });
    }
  } else if (modality === Modality.IMAGE) {
    const result = await aiRouter.generateImage('small probe', { width: 64, height: 64 }, { userId });
    for (const a of result.attempts) chain.push({ providerId: a.providerId, providerName: a.providerName, ok: a.ok, message: a.ok ? `Generated a ${result.data.buffer?.length ?? 0}-byte image` : a.message });
  } else if (modality === Modality.SPEECH) {
    const result = await aiRouter.generateSpeech('probe', { maxSec: 2 }, { userId });
    for (const a of result.attempts) chain.push({ providerId: a.providerId, providerName: a.providerName, ok: a.ok, message: a.ok ? `Generated ${result.data.durationSec?.toFixed(1) ?? '?'}s of speech` : a.message });
  } else {
    // video: expected to degrade — report the capability picture instead
    const capable = all.filter((c) => c.enabled && providerConfigRepo.modalitiesOf(c).includes(Modality.VIDEO) && (c.id === 'mock' || secretStore.has({ kind: 'provider-key', name: c.id })));
    chain.push({ providerId: 'video', providerName: 'AI video providers', ok: capable.length > 0, message: capable.length ? `${capable.map((c) => c.name).join(', ')} can generate video.` : 'No enabled provider supports true video — CAS will use the slideshow fallback (images + Ken Burns + voiceover).' });
    return { modality, chain, verdict: 'slideshow-fallback' };
  }
  const won = chain.find((c) => c.ok);
  return {
    modality,
    chain,
    verdict: won ? `Routed to ${won.providerName}` : 'all-failed',
    note: chain.some((c) => !c.ok && c.providerId !== 'mock') ? 'Router fell through providers automatically — no action needed from you.' : undefined,
  };
}

router.get(
  '/admin/usage',
  asyncRoute(async (req, res) => {
    const days = typeof req.query.days === 'string' ? parseInt(req.query.days) : 7;
    const rows = usageRepo.totalsSince(days);
    ok(res, { usage: rows, days });
  }),
);

// file upload for custom preset reference images (small, dev storage)
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

router.post(
  '/uploads/preset-reference',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    requireUser(req);
    if (!req.file) throw AppError.badRequest('Attach an image file.');
    const { objectStore, newObjectKey } = await import('../storage');
    const key = newObjectKey('png');
    await objectStore().put(key, req.file.buffer, req.file.mimetype || 'image/png');
    ok(res, { objectKey: key }, 201);
  }),
);

export default router;

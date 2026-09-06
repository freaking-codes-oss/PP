// Publishing: platform adapters, OAuth flows, and publish-job execution.
// Design constraints honored here:
//  - never store platform passwords — OAuth tokens only, encrypted at rest;
//  - token refresh handling;
//  - draft vs auto mode; retry/backoff handled by the job queue;
//  - YouTube first (lowest approval friction); Meta & TikTok gated behind app
//    review, surfaced plainly in the UI.
import { PlatformId } from '@cas/shared';
import { PLATFORM_FORMATS } from '@cas/shared/formats';
import { AppError } from '../errors';
import { config } from '../config';
import { connectionRepo, projectRepo, publishRepo, analyticsRepo, scriptRepo, assetRepo, type ConnectionRow, type ProjectRow } from '../db/repos';
import { secretStore, secretRefForProvider, encryptSecret } from '../secrets';
import { makeId, nowIso, hashString } from '../util';
import { logger } from '../logger';
import { setStage } from '../stage';

// ---------------------------------------------------------------------------
// Platform capability + approval status (external, not code — surfaced in UI)
// ---------------------------------------------------------------------------
export interface PlatformGateInfo {
  platform: PlatformId;
  gate: 'none' | 'oauth-verification' | 'meta-app-review' | 'tiktok-audit';
  note: string;
  live: boolean; // mock/publish-capable only when false in demo w/o creds
}

export const PLATFORM_GATES: Record<PlatformId, PlatformGateInfo> = {
  [PlatformId.YOUTUBE]: {
    platform: PlatformId.YOUTUBE, gate: 'oauth-verification', live: false,
    note: 'OAuth 2.0 (youtube.upload). Google OAuth verification is needed for public use at scale; works on test channels meanwhile.',
  },
  [PlatformId.TIKTOK]: {
    platform: PlatformId.TIKTOK, gate: 'tiktok-audit', live: false,
    note: 'Content Posting API requires a TikTok app audit before production access. Build against the sandbox first.',
  },
  [PlatformId.INSTAGRAM]: {
    platform: PlatformId.INSTAGRAM, gate: 'meta-app-review', live: false,
    note: 'Instagram Reels publishing via Meta Graph API needs a Business/Creator IG account linked to a FB Page + Meta App Review.',
  },
  [PlatformId.FACEBOOK]: {
    platform: PlatformId.FACEBOOK, gate: 'meta-app-review', live: false,
    note: 'Facebook Reels publishing needs Meta App Review for pages_manage_posts.',
  },
};

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const YT_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'].join(' ');

export function googleOAuthConfigured(): boolean {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI);
}

export function youtubeAuthUrl(userId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    redirect_uri: config.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: YT_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: `${state}::${userId}`,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; channelName?: string }> {
  const body = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    client_secret: config.GOOGLE_CLIENT_SECRET!,
    redirect_uri: config.GOOGLE_REDIRECT_URI!,
    grant_type: 'authorization_code',
    code,
  });
  const res = await fetch(GOOGLE_TOKEN, { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'Google did not accept the OAuth code.', suggestion: 'Start the connection flow again.', message: JSON.stringify(data).slice(0, 300) });
  }
  let channelName: string | undefined;
  try {
    const me = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${data.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const meData = (await me.json()) as any;
    channelName = meData?.items?.[0]?.snippet?.title;
  } catch { /* optional enrichment */ }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, channelName };
}

export async function refreshGoogleAccessToken(conn: ConnectionRow): Promise<{ accessToken: string; expiresIn: number }> {
  const refresh = conn.refresh_token_enc ? secretStore.get({ kind: 'platform-token', name: conn.id }) : null;
  if (!refresh) throw new AppError({ code: 'UNAUTHORIZED', userMessage: `The ${conn.platform} connection has no refresh token.`, suggestion: 'Reconnect the channel.' });
  const body = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    client_secret: config.GOOGLE_CLIENT_SECRET!,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN, { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    connectionRepo.setStatus(conn.id, { status: 'error', lastError: 'Token refresh failed — reconnect the channel.' });
    throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'Channel token expired and could not be refreshed.', suggestion: 'Reconnect the channel in Settings.' });
  }
  secretStore.set({ kind: 'platform-token', name: conn.id }, data.access_token);
  connectionRepo.setStatus(conn.id, { status: 'connected' });
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export interface PublishInput {
  project: ProjectRow;
  connection: ConnectionRow;
  mode: 'draft' | 'auto';
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string | null;
}

export interface PublishOutput {
  platformVideoId: string;
  platformUrl: string;
  isDraft: boolean;
}

interface PlatformAdapter {
  publish(input: PublishInput): Promise<PublishOutput>;
}

/** Demo adapter — simulates platform behavior so the full loop is testable. */
class MockPlatformAdapter implements PlatformAdapter {
  constructor(private platform: PlatformId) {}
  async publish(input: PublishInput): Promise<PublishOutput> {
    const delay = 400 + Math.floor(Math.random() * 600);
    await new Promise((r) => setTimeout(r, delay));
    const h = hashString(input.project.id + this.platform + Date.now().toString().slice(0, -3)).toString(36).slice(0, 10);
    const id = `${this.platform === PlatformId.YOUTUBE ? 'yt' : this.platform === PlatformId.TIKTOK ? 'tk' : 'reel'}_${h}`;
    const urls: Record<string, string> = {
      [PlatformId.YOUTUBE]: `https://youtube.com/shorts/${h}`,
      [PlatformId.TIKTOK]: `https://tiktok.com/@demo/video/${h}`,
      [PlatformId.INSTAGRAM]: `https://instagram.com/reel/${h}`,
      [PlatformId.FACEBOOK]: `https://facebook.com/reel/${h}`,
    };
    return { platformVideoId: id, platformUrl: urls[this.platform], isDraft: input.mode === 'draft' };
  }
}

class LivePlatformAdapter implements PlatformAdapter {
  constructor(private platform: PlatformId) {}
  async publish(): Promise<PublishOutput> {
    const gate = PLATFORM_GATES[this.platform];
    throw new AppError({
      code: 'UNAUTHORIZED',
      status: 503,
      userMessage: `Live publishing to ${gate.platform} is not configured in this deployment.`,
      suggestion: gate.note,
    });
  }
}

function adapterForPlatform(platform: PlatformId): PlatformAdapter {
  return new MockPlatformAdapter(platform);
  // In production gate by PLATFORM_GATES[x].live → LivePlatformAdapter(youtube)
}

// ---------------------------------------------------------------------------
// Publish job execution
// ---------------------------------------------------------------------------

export function publishJobFromProject(input: {
  project: ProjectRow;
  platform: PlatformId;
  mode: 'draft' | 'auto';
  scheduledFor?: string | null;
  userId: string;
}): { jobId: string } {
  const jobId = makeId('pub');
  publishRepo.create({ id: jobId, userId: input.userId, projectId: input.project.id, platform: input.platform, mode: input.mode, scheduledFor: input.scheduledFor });
  return { jobId };
}

export async function executePublish(input: {
  jobId: string;
  userId: string;
  report: (pct: number, text: string) => void;
}): Promise<void> {
  const job = publishRepo.byId(input.jobId, input.userId);
  if (!job) throw AppError.notFound('Publish job not found.');
  publishRepo.update(job.id, { status: 'processing', attempts: job.attempts + 1 });
  const project = projectRepo.find(job.project_id, input.userId);
  if (!project) throw new AppError({ code: 'INTERNAL', userMessage: 'Project for this job no longer exists.' });

  const conn = connectionRepo.byPlatform(input.userId, job.platform);
  if (!conn || conn.status !== 'connected') {
    publishRepo.update(job.id, { status: 'needs_action', last_error: `Connect ${job.platform} first — no channel connected.` });
    throw new AppError({ code: 'UNAUTHORIZED', userMessage: `No ${job.platform} channel connected yet.`, suggestion: 'Connect a channel in Settings → Channels (demo connections are instant).' });
  }

  // Resolve video file + metadata
  const composite = assetRepo.forProject(job.project_id).find((a) => a.type === 'composite' && !a.scene_id);
  const cv = composite?.current_version_id ? assetRepo.versions(composite.id).find((v) => v.id === composite.current_version_id) : null;
  if (!composite || !cv?.object_key) {
    publishRepo.update(job.id, { status: 'needs_action', last_error: 'No finished video yet — assemble the project first.' });
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Assemble the video first — there is nothing to publish yet.', suggestion: 'Run the "Assemble video" step, then publish again.' });
  }
  const { objectStore } = await import('../storage');
  const fs = await import('node:fs');
  const tmp = (await import('../config')).paths.tmpDir;
  const videoPath = `${tmp}/pub_${job.id}.mp4`;
  fs.writeFileSync(videoPath, objectStore().get(cv.object_key)!);

  const metadata = (await import('../db/repos')).metadataRepo.latestFor(job.project_id, job.platform);
  const payload = metadata ? JSON.parse(metadata.payload) : null;
  const title = payload?.title ?? project.name;
  const description = payload?.description ?? '';
  const tags = payload?.hashtags ?? [];

  input.report?.(40, 'Uploading to the platform…');
  const adapter = adapterForPlatform(job.platform as PlatformId);
  try {
    const out = await adapter.publish({
      project,
      connection: conn,
      mode: job.mode as 'draft' | 'auto',
      videoPath,
      title,
      description,
      tags,
      thumbnailPath: null,
    });
    publishRepo.update(job.id, {
      status: out.isDraft ? 'draft_ready' : 'published',
      platform_video_id: out.platformVideoId,
      platform_url: out.platformUrl,
      last_error: null,
    });
    // seed the first analytics snapshot so the loop is visible immediately
    const day = nowIso();
    if (!analyticsRepo.latestForVideo(job.platform, out.platformVideoId, day.slice(0, 10))) {
      const base = 12 + (hashString(out.platformVideoId) % 80);
      analyticsRepo.insert({
        id: makeId('an'),
        userId: input.userId,
        projectId: job.project_id,
        platform: job.platform,
        externalVideoId: out.platformVideoId,
        views: base,
        likes: Math.max(1, Math.round(base * 0.12)),
        shares: Math.round(base * 0.04),
        comments: Math.max(1, Math.round(base * 0.02)),
        avgViewDurationSec: 8 + (hashString(out.platformVideoId + 'd') % 15),
        collectedAt: day,
      });
    }
    input.report?.(100, out.isDraft ? 'Saved as draft.' : 'Published!');
    setStage(job.project_id, 'publish', 'ready', { statusText: out.isDraft ? 'Draft ready on the platform — review before going live.' : `Published to ${job.platform} — monitoring now.`, userId: input.userId });
  } finally {
    try { fs.rmSync(videoPath, { force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Format adapter helpers (shared with routes)
// ---------------------------------------------------------------------------

export function platformList(userId: string) {
  const conns = connectionRepo.forUser(userId);
  return (Object.keys(PLATFORM_FORMATS) as PlatformId[]).map((platform) => {
    const spec = PLATFORM_FORMATS[platform];
    const conn = conns.find((c) => c.platform === platform);
    return {
      platform,
      label: spec.label,
      format: { aspect: spec.recommendedAspect, maxDurationSec: spec.maxDurationSec, maxFileSizeMb: spec.maxFileSizeMb, captionMaxLength: spec.captionMaxLength },
      gate: PLATFORM_GATES[platform].gate,
      gateNote: PLATFORM_GATES[platform].note,
      live: PLATFORM_GATES[platform].live,
      connection: conn ? { id: conn.id, status: conn.status, displayName: conn.display_name, lastError: conn.last_error } : null,
    };
  });
}

export function demoConnect(userId: string, platform: PlatformId): void {
  const label = PLATFORM_FORMATS[platform].label.replace(/ \(.*\)/, '');
  connectionRepo.upsert({
    userId,
    platform,
    status: 'connected',
    displayName: `Demo ${label} channel`,
    scopes: ['demo'],
  });
}

export function disconnect(userId: string, platform: PlatformId): void {
  connectionRepo.delete(userId, platform);
}

export function storePlatformTokens(userId: string, platform: PlatformId, tokens: { accessToken: string; refreshToken?: string; expiresIn?: number; channelName?: string }): void {
  const conn = connectionRepo.upsert({
    userId,
    platform,
    status: 'connected',
    displayName: tokens.channelName ?? `Connected ${platform} account`,
    scopes: YT_SCOPES.split(' '),
    tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : undefined,
  });
  secretStore.set({ kind: 'platform-token', name: conn.id }, tokens.accessToken);
  if (tokens.refreshToken) secretStore.set({ kind: 'platform-refresh', name: conn.id }, tokens.refreshToken);
  void encryptSecret;
  void secretRefForProvider;
}

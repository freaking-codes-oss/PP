// Cross-platform analytics normalization + scheduled sync (Layer 5).
// Every platform's numbers are folded into one snapshot row per (video, day).
// Live adapters pull from each API; the demo grows snapshots deterministically.
import { analyticsRepo, publishRepo, connectionRepo, type AnalyticsRow } from '../db/repos';
import { hashString, makeId, nowIso, dayKey } from '../util';

export interface MetricPoint {
  collectedAt: string;
  views: number;
  likes: number;
  shares: number;
  comments: number;
}

export interface VideoSeries {
  platform: string;
  externalVideoId: string;
  projectId: string;
  title?: string;
  url?: string | null;
  points: MetricPoint[];
}

function seededGrowth(videoId: string, dayIndex: number): { views: number; likes: number; shares: number; comments: number; avg: number } {
  const seed = hashString(videoId);
  const cap = 250 + (seed % 4000);
  const k = 0.35 + ((seed >> 3) % 20) / 100;
  const views = Math.floor(cap / (1 + Math.exp(-k * (dayIndex - 4)))) + (hashString(videoId + 'n' + dayIndex) % 7);
  const likeRate = 0.05 + ((seed >> 5) % 12) / 100;
  const likes = Math.max(1, Math.round(views * likeRate));
  const shares = Math.round(views * 0.02 + (hashString(videoId + 's' + dayIndex) % 9));
  const comments = Math.max(1, Math.round(views * 0.01) + (hashString(videoId + 'c' + dayIndex) % 5));
  const avg = 7 + ((seed >> 7) % 16) + Math.max(0, 10 - dayIndex);
  return { views, likes, shares, comments, avg };
}

export async function syncAnalyticsForUser(userId: string): Promise<number> {
  const jobs = publishRepo.recentForUser(userId, 200).filter((j) => j.platform_video_id && (j.status === 'published' || j.status === 'draft_ready'));
  const conns = connectionRepo.forUser(userId).filter((c) => c.status === 'connected');
  let inserted = 0;
  const today = new Date();
  for (const job of jobs) {
    // only platforms we can observe (mock connections, or real adapters later)
    if (!conns.find((c) => c.platform === job.platform)) continue;
    const videoId = job.platform_video_id;
    if (!videoId) continue;
    const publishedAt = new Date(job.created_at);
    const maxDay = Math.min(14, Math.max(0, Math.floor((today.getTime() - publishedAt.getTime()) / 86_400_000)));
    for (let d = 0; d <= maxDay; d++) {
      const when = new Date(publishedAt.getTime() + d * 86_400_000);
      const key = dayKey(when);
      if (key > dayKey(today)) break;
      if (analyticsRepo.latestForVideo(job.platform, videoId, key)) continue;
      const g = seededGrowth(videoId, d);
      const collected = new Date(publishedAt.getTime() + d * 86_400_000 + 6 * 3600_000); // ~midday snapshot
      if (collected > today) continue;
      analyticsRepo.insert({
        id: makeId('an'),
        userId,
        projectId: job.project_id,
        platform: job.platform,
        externalVideoId: videoId,
        views: g.views,
        likes: g.likes,
        shares: g.shares,
        comments: g.comments,
        watchTimeSec: g.views * g.avg,
        avgViewDurationSec: g.avg,
        collectedAt: collected.toISOString(),
      });
      inserted++;
    }
  }
  return inserted;
}

export async function seriesForProject(projectId: string, days = 14): Promise<VideoSeries[]> {
  const rows = analyticsRepo.forProject(projectId, days);
  const jobs = publishRepo.forProject(projectId);
  const byVideo = new Map<string, AnalyticsRow[]>();
  for (const r of rows) {
    const key = `${r.platform}:${r.external_video_id}`;
    const list = byVideo.get(key) ?? [];
    list.push(r);
    byVideo.set(key, list);
  }
  const out: VideoSeries[] = [];
  for (const [key, list] of byVideo) {
    const [platform, externalVideoId] = key.split(':');
    const job = jobs.find((j) => j.platform_video_id === externalVideoId);
    out.push({
      platform,
      externalVideoId,
      projectId,
      title: job ? `#${(job.created_at.slice(0, 10))} post` : undefined,
      url: job?.platform_url ?? null,
      points: list
        .sort((a, b) => a.collected_at.localeCompare(b.collected_at))
        .map((r) => ({
          collectedAt: r.collected_at,
          views: r.views,
          likes: r.likes,
          shares: r.shares,
          comments: r.comments,
        })),
    });
  }
  return out;
}

export function totalsFor(rows: AnalyticsRow[]) {
  const totals = {
    views: rows.reduce((s, r) => s + r.views, 0),
    likes: rows.reduce((s, r) => s + r.likes, 0),
    shares: rows.reduce((s, r) => s + r.shares, 0),
    comments: rows.reduce((s, r) => s + r.comments, 0),
  };
  const latestByDay = new Map<string, AnalyticsRow>();
  for (const r of rows) {
    const d = r.collected_at.slice(0, 10);
    latestByDay.set(d, r);
  }
  const first = rows.length ? rows[0] : null;
  const last = rows.length ? rows[rows.length - 1] : null;
  return {
    totals,
    series: [...latestByDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, r]) => ({ day, views: r.views, likes: r.likes, shares: r.shares, comments: r.comments })),
    growthPct: first && last && first.views > 0 ? Math.round(((last.views - first.views) / first.views) * 100) : 0,
  };
}

// Trend tracking (Layer 5).
// YouTube-mostPopular-style entries come from a curated dataset (the real API
// needs a YouTube Data API key + quota); TikTok/IG have no official discovery
// API, so manual curation is a first-class source. A third-party provider slot
// is reserved for later. Trend data feeds back into Stage 1 ideation.
import { AppError } from '../errors';
import { trendRepo, type TrendRow } from '../db/repos';
import { makeId, nowIso, hashString } from '../util';

export interface CuratedTrend {
  title: string;
  category: string;
  regions: string[];
  baseScore: number;
}

// Generic "currently rising" titles — deliberately category-level so nothing
// here impersonates a real video. Swap with the YouTube mostPopular response
// when a YouTube Data API key is configured (see scanTrends below).
export const CURATED: CuratedTrend[] = [
  { title: '5-minute morning routines that actually stick', category: 'Lifestyle', regions: ['US', 'GB', 'IN', 'BR'], baseScore: 88 },
  { title: 'Overlooked keyboard shortcuts that save an hour a day', category: 'Tech', regions: ['US', 'GB', 'DE', 'IN'], baseScore: 84 },
  { title: 'A 28-day habit reset: what changes first', category: 'Self improvement', regions: ['US', 'IN', 'GB', 'MX'], baseScore: 81 },
  { title: 'One-ingredient cooking hacks from a professional chef', category: 'Food', regions: ['US', 'BR', 'FR', 'IT'], baseScore: 86 },
  { title: 'Room makeovers under $50: before and after', category: 'Home', regions: ['US', 'GB', 'BR'], baseScore: 79 },
  { title: 'The science of better sleep in under 3 minutes', category: 'Health', regions: ['US', 'GB', 'DE', 'JP'], baseScore: 83 },
  { title: 'AI tools creatives are quietly using in 2026', category: 'Tech', regions: ['US', 'IN', 'GB'], baseScore: 90 },
  { title: 'How creators plan a week of content in one hour', category: 'Creators', regions: ['US', 'GB', 'IN', 'BR'], baseScore: 87 },
  { title: 'Small language habits that make you sound clearer', category: 'Communication', regions: ['US', 'GB', 'IN'], baseScore: 78 },
  { title: 'Cheap gym alternatives for busy weeks', category: 'Fitness', regions: ['US', 'GB', 'MX', 'IN'], baseScore: 80 },
  { title: 'Packing hacks frequent travelers swear by', category: 'Travel', regions: ['US', 'GB', 'JP', 'BR'], baseScore: 82 },
  { title: 'How to read one book a week without trying hard', category: 'Self improvement', regions: ['US', 'IN', 'GB', 'CA'], baseScore: 77 },
  { title: 'Gadget desk setups that fix your posture', category: 'Tech', regions: ['US', 'DE', 'GB', 'KR'], baseScore: 76 },
  { title: 'Budget meal prep: $1.50 per meal ideas', category: 'Food', regions: ['US', 'IN', 'BR', 'MX'], baseScore: 85 },
  { title: 'Phone camera settings pros change first', category: 'Creators', regions: ['US', 'GB', 'IN', 'JP'], baseScore: 81 },
  { title: 'Why your plants keep dying (and the fix)', category: 'Home', regions: ['US', 'GB', 'NL', 'CA'], baseScore: 74 },
  { title: '30-second desk stretches for long workdays', category: 'Health', regions: ['US', 'GB', 'JP', 'DE'], baseScore: 78 },
  { title: 'Side hustles that start with skills you have', category: 'Money', regions: ['US', 'IN', 'GB', 'NG'], baseScore: 89 },
  { title: 'The perfect phone lock screen, explained', category: 'Tech', regions: ['US', 'KR', 'JP', 'GB'], baseScore: 72 },
  { title: 'Beginner photography: natural light only', category: 'Creators', regions: ['US', 'BR', 'GB', 'FR'], baseScore: 75 },
];

export const TREND_REGIONS = ['US', 'GB', 'IN', 'BR', 'DE', 'JP'];

export function listTrends(opts: { source?: string; region?: string; limit?: number; include?: boolean }) {
  void opts.include;
  return trendRepo.list({ source: opts.source, region: opts.region, limit: opts.limit });
}

export function addManualTrend(input: { title: string; category?: string; url?: string; reason?: string; region?: string }): TrendRow {
  if (!input.title.trim()) throw AppError.badRequest('A title is required for a manual trend entry.');
  const id = makeId('tr');
  trendRepo.insert({
    id,
    source: 'manual',
    title: input.title.trim(),
    category: input.category ?? 'Manual pick',
    region: input.region ?? null,
    url: input.url ?? null,
    reason: input.reason ?? null,
    score: 70,
  });
  return trendRepo.list({ limit: 100 }).find((t) => t.id === id)!;
}

/** Daily scan job: refresh auto sources, keep manual entries. */
export async function scanTrends(): Promise<{ inserted: number; keptManual: number }> {
  // 1. fresh auto feed for a rolling set of regions
  const now = nowIso();
  let inserted = 0;
  const region = TREND_REGIONS[Math.floor(Date.now() / 86_400_000) % TREND_REGIONS.length];
  const picks = [...CURATED].sort((a, b) => b.baseScore - a.baseScore).slice(0, 12);
  for (const c of picks) {
    const drift = (hashString(c.title + now.slice(0, 10)) % 7) - 3;
    trendRepo.insert({
      id: makeId('tr'),
      source: 'youtube-most-popular',
      title: c.title,
      category: c.category,
      region,
      score: Math.max(50, Math.min(99, c.baseScore + drift)),
      pickedAt: now,
      reason: c.regions.includes(region) ? `Consistently rising in ${region}` : `Strong recent growth (${region} sample)`,
    });
    inserted++;
  }
  // prune auto rows older than 3 days; manual rows are kept indefinitely
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  trendRepo.deleteSourceOlderThan('youtube-most-popular', threeDaysAgo);
  const keptManual = trendRepo.list({ source: 'manual', limit: 500 }).length;
  return { inserted, keptManual };
}

export function trendContextByIds(ids: string[]): { title: string; source: string }[] {
  if (!ids?.length) return [];
  const all = trendRepo.list({ limit: 500 });
  return ids
    .map((id) => all.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => ({ title: t!.title, source: t!.source }));
}

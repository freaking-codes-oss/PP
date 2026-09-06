// Seed data: built-in style presets + a rich demo account so every surface
// (wizard, review, publishing, analytics, trends) is explorable on first boot.
import { getDb } from './db';
import { userRepo, projectRepo, styleRepo, connectionRepo, publishRepo, analyticsRepo, trendRepo, scriptRepo, metadataRepo, stageRepo } from './repos';
import { makeId, nowIso, hashString } from '../util';
import { PlatformId, PipelineStage } from '@cas/shared';
import type { Scene } from '@cas/shared';
import { PLATFORM_FORMATS } from '@cas/shared';
import { logger } from '../logger';
import { CURATED, TREND_REGIONS } from '../lib/trends';

const BUILTIN_PRESETS = [
  {
    id: 'preset_studio-teal', name: 'Studio Teal', builtIn: true, paletteKey: 'teal',
    description: 'Calm dark-teal gradient posters with warm amber accents. Balanced, editorial, approachable.',
    visualStyle: 'clean editorial poster, dark teal gradient, soft glowing light source, geometric overlays',
    captionStyle: 'Bold white caps, dark box, teal accent bar, centered',
    tone: 'calm, encouraging, expert',
    musicMood: 'soft ambient pad',
  },
  {
    id: 'preset_sunset-pop', name: 'Sunset Pop', builtIn: true, paletteKey: 'sunset',
    description: 'High-energy purple/pink/orange palette for bold hooks and punchy content.',
    visualStyle: 'bold pop poster, sunset purple-to-coral gradient, halftone rings, vibrant',
    captionStyle: 'Heavy white caps with dark outline + coral underline',
    tone: 'energetic, playful, direct',
    musicMood: 'upbeat lo-fi',
  },
  {
    id: 'preset_aurora', name: 'Aurora', builtIn: true, paletteKey: 'aurora',
    description: 'Deep teal-to-mint with icy highlights — calm, premium, tech-forward.',
    visualStyle: 'premium cinematic poster, deep teal gradient with mint aurora glow, minimal geometry',
    captionStyle: 'Light mint caps, subtle dark box',
    tone: 'sophisticated, measured, confident',
    musicMood: 'cinematic ambient',
  },
  {
    id: 'preset_studio-noir', name: 'Studio Noir', builtIn: true, paletteKey: 'mono',
    description: 'Monochrome with bright highlights for a high-contrast, modern feel.',
    visualStyle: 'monochrome poster, charcoal gradient, stark highlights, duotone geometry',
    captionStyle: 'White caps on black slab, no border',
    tone: 'sharp, minimal, authoritative',
    musicMood: 'dark ambient',
  },
  {
    id: 'preset_candy-pop', name: 'Candy Pop', builtIn: true, paletteKey: 'candy',
    description: 'Purple/magenta/cyan candy palette — playful, loud, scroll-stopping.',
    visualStyle: 'playful candy poster, purple-to-magenta gradient, neon rings and dots',
    captionStyle: 'Thick white caps, magenta outline, cyan accents',
    tone: 'fun, energetic, youthful',
    musicMood: 'playful synth',
  },
];

export function seedIfEmpty(): void {
  const db = getDb();
  const users = db.get('SELECT COUNT(*) AS c FROM users') as { c: number };
  if (Number(users.c) > 0) return;
  logger.info('Empty database — seeding demo data…');

  // style presets (idempotent-ish: only when empty)
  const count = db.get('SELECT COUNT(*) AS c FROM style_presets') as { c: number };
  if (Number(count.c) === 0) {
    for (const p of BUILTIN_PRESETS) {
      const pal = { teal: ['#0b2e2a', '#0f4c44', '#1f8a70', '#7fd8be', '#ffe8a3', '#0a1f1c'], sunset: ['#1b1035', '#5b2a86', '#e0527d', '#ff9470', '#ffd166', '#2a1654'], aurora: ['#062b3c', '#0f5c68', '#31b6a0', '#9ff3df', '#3c6e71', '#04212e'], mono: ['#0c0c0e', '#232329', '#4a4a55', '#e6e6ea', '#f6f6f8', '#111114'], candy: ['#2d0a3d', '#8a2be2', '#ff4f9a', '#ffd447', '#7ef0ff', '#1d0628'] }[p.paletteKey];
      styleRepo.create({
        id: p.id, builtIn: true, name: p.name, description: p.description,
        visualStyle: p.visualStyle, colorPalette: `${p.paletteKey} palette`, captionStyle: p.captionStyle,
        tone: p.tone, musicMood: p.musicMood, swatches: pal!,
      });
    }
  }

  // demo user
  const demoId = 'usr_demo';
  userRepo.create({ id: demoId, email: 'demo@cas.dev', password_hash: '$2a$10$demodemo' , name: 'Demo Creator' });

  // demo projects
  const projects = [
    { id: makeId('prj'), name: 'Coffee rituals that save mornings', topic: 'coffee routines', angle: 'The 5-minute rule: a tiny routine that compounds', days: 13 },
    { id: makeId('prj'), name: 'Side hustles that start with skills you have', topic: 'side hustles', angle: 'Why everyone is wrong about side hustles right now', days: 6 },
  ];

  const now = Date.now();
  for (let pIdx = 0; pIdx < projects.length; pIdx++) {
    const p = projects[pIdx];
    const createdAgo = now - p.days * 86_400_000;
    const projectId = p.id;
    // create project row w/ created_at older for realistic ordering
    const idea = {
      prompt: p.topic,
      angles: [
        { id: 'angle_1', title: p.angle, hook: `Most people get ${p.topic} wrong — here is the fix.`, angle: 'start with the smallest repeatable action.', audience: 'busy beginners', difficulty: 'easy' },
        { id: 'angle_2', title: `3 mistakes killing your progress with ${p.topic}`, hook: `Nobody tells you this about ${p.topic}.`, angle: 'remove friction first.', audience: 'self-improvers', difficulty: 'medium' },
        { id: 'angle_3', title: `Do this every morning and watch your ${p.topic} change`, hook: `Stop scrolling — this changes how you think about ${p.topic}.`, angle: 'consistency beats intensity.', audience: 'creators', difficulty: 'easy' },
      ],
      selectedAngleId: 'angle_1',
    };
    getDb().run(
      `INSERT INTO projects (id, user_id, name, idea, current_stage, style_preset_id, video_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [projectId, demoId, p.name, JSON.stringify(idea), 'publish', 'preset_studio-teal', 'slideshow', new Date(createdAgo).toISOString(), new Date(createdAgo + 86400_000).toISOString()],
    );
    // stages all ready
    for (const stage of Object.values(PipelineStage)) {
      stageRepo.upsert(projectId, stage, { state: 'ready', progress: 100, status_text: 'Seeded demo — explore the results below.' });
    }
    // script version
    const scenes: Scene[] = [
      { id: 'scene_1', visual_description: 'hook frame — macro shot of a pour-over coffee, warm morning light', voiceover: 'Most people get coffee routines wrong. Here is the fix.', on_screen_text: 'THE COFFEE FIX', duration_sec: 4 },
      { id: 'scene_2', visual_description: 'overhead flat-lay of coffee gear and a notebook', voiceover: 'Set up everything the night before — beans, water, grinder.', on_screen_text: 'PREP THE NIGHT BEFORE', duration_sec: 4 },
      { id: 'scene_3', visual_description: 'hands grinding beans, steam rising', voiceover: 'Grind fresh and weigh your dose, every single day.', on_screen_text: 'GRIND FRESH', duration_sec: 5 },
      { id: 'scene_4', visual_description: 'slow pour-over bloom close up', voiceover: 'Bloom for thirty seconds — it unlocks the flavor.', on_screen_text: 'BLOOM 30 SECONDS', duration_sec: 5 },
      { id: 'scene_5', visual_description: 'final cup, cozy desk scene', voiceover: 'Keep it small and daily. That is the whole trick.', on_screen_text: 'SMALL DAILY WINS', duration_sec: 4 },
      { id: 'scene_6', visual_description: 'branded ending card with coffee motif', voiceover: 'Follow for part two — and try one idea today.', on_screen_text: 'FOLLOW FOR PART 2', duration_sec: 4 },
    ];
    const script = { title: p.angle, overview: `A punchy 6-scene short about ${p.topic}.`, scenes };
    scriptRepo.insert({ id: makeId('scr'), projectId, version: 1, source: 'ai', script });
    // metadata per platform
    for (const platform of [PlatformId.YOUTUBE, PlatformId.TIKTOK, PlatformId.FACEBOOK, PlatformId.INSTAGRAM]) {
      const spec = PLATFORM_FORMATS[platform];
      const tags = ['#shorts', '#coffee', '#morningroutine'].slice(0, platform === PlatformId.YOUTUBE ? 3 : 2);
      metadataRepo.insert({
        id: makeId('meta'), projectId, platform, version: 1,
        payload: {
          platform, title: p.angle.slice(0, 80), description: `${p.angle}\n\nMore ${p.topic} content weekly.\n\n${tags.join(' ')}`,
          hashtags: tags, thumbnailConcepts: [`[Demo thumb] High contrast ${p.topic} scene with bold text`],
        },
      });
    }
    // platform connections (mock)
    for (const platform of Object.values(PlatformId)) {
      const label = PLATFORM_FORMATS[platform].label.replace(/ \(.*\)/, '');
      connectionRepo.upsert({ userId: demoId, platform, status: 'connected', displayName: `Demo ${label}`, scopes: ['demo'] });
    }
    // published jobs + analytics snapshots growing over time
    for (const platform of Object.values(PlatformId)) {
      const vidHash = hashString(projectId + platform).toString(36).slice(0, 10);
      const externalId = `${platform === PlatformId.YOUTUBE ? 'yt' : platform === PlatformId.TIKTOK ? 'tk' : 'reel'}_${vidHash}`;
      const pubId = makeId('pub');
      const created = new Date(createdAgo + 2 * 86_400_000).toISOString();
      getDb().run(
        `INSERT INTO publish_jobs (id, user_id, project_id, platform, status, mode, attempts, max_attempts, platform_video_id, platform_url, last_error, scheduled_for, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pubId, demoId, projectId, platform, 'published', 'auto', 1, 3, externalId, `https://example.com/${externalId}`, null, null, created, created],
      );
      // snapshots: every day since publish (deterministic growth), 2-4 metrics per video
      const days = p.days - 2;
      for (let d = 0; d < days; d++) {
        const seed = hashString(externalId);
        const cap = 800 + (seed % 6000) + pIdx * 900;
        const k = 0.35;
        const views = Math.floor(cap / (1 + Math.exp(-k * (d - 3)))) + (hashString(externalId + 'n' + d) % 11);
        const collected = new Date(createdAgo + (d + 2) * 86_400_000 + 6 * 3600_000).toISOString();
        if (collected > nowIso()) break;
        analyticsRepo.insert({
          id: makeId('an'), userId: demoId, projectId, platform, externalVideoId: externalId,
          views,
          likes: Math.round(views * 0.09),
          shares: Math.round(views * 0.02),
          comments: Math.max(1, Math.round(views * 0.012)),
          watchTimeSec: views * 14,
          avgViewDurationSec: 12 + (seed % 8),
          collectedAt: collected,
        });
      }
    }
    void projectId;
  }

  // trends: a rolling "today" sample for a few regions
  const today = nowIso();
  for (const region of TREND_REGIONS.slice(0, 3)) {
    const sample = [...CURATED].sort((a, b) => b.baseScore - a.baseScore).slice(0, 6);
    sample.forEach((c, i) => {
      trendRepo.insert({
        id: makeId('tr'), source: i < 4 ? 'youtube-most-popular' : 'manual', title: c.title, category: c.category,
        region, score: Math.min(99, c.baseScore + (hashString(c.title + region + today.slice(0, 10)) % 6) - 2),
        reason: c.regions.includes(region) ? `Rising in ${region} this week` : 'Editorial pick',
        pickedAt: today,
      });
    });
  }
  trendRepo.insert({ id: makeId('tr'), source: 'manual', title: 'Behind-the-scenes: how I film one short in 40 minutes', category: 'Creators', region: 'US', reason: 'Editorial pick for the demo', pickedAt: today });

  logger.info('Demo seed complete: 2 projects with published analytics, connections, trends, style presets.');
}

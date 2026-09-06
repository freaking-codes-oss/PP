// Deterministic text "brain" for the mock provider. Produces structured JSON
// that mirrors what real LLM calls return for each pipeline task, with a small
// seeded variety so regenerate actually changes results.
import { hashString } from '../util';
import type { Scene, PlatformId } from '@cas/shared';

const HOOK_OPENERS = [
  'Most people get {topic} wrong — here is the fix.',
  'Stop scrolling — this changes how you think about {topic}.',
  'Nobody tells you this about {topic}.',
  'I tested {topic} for 30 days so you do not have to.',
  'The {topic} hack that feels illegal to know.',
];

const ANGLE_HOOKS = [
  '3 mistakes killing your progress with {topic} (and what to do instead)',
  'The 5-minute rule: a tiny routine that compounds on {topic}',
  'What 100 hours of {topic} taught me in 60 seconds',
  'The untold science behind {topic}',
  'Do this every morning and watch your {topic} change',
  'Why everyone is wrong about {topic} right now',
  'The beginner to pro roadmap for {topic}, simplified',
  'One tool that quietly makes {topic} effortless',
];

const ANGLE_POINTS = [
  'start with the smallest repeatable action and build a streak',
  'remove friction: prepare everything the night before',
  'measure one metric only, ignore the noise',
  'copy proven patterns first, then experiment',
  'batch the boring parts so focus survives',
  'teach it to someone to lock it in',
  'schedule it like a non-negotiable meeting',
  'review weekly and cut what is not moving the needle',
];

const BEAT_LINES = [
  'Here is the next step: keep the momentum small but daily — consistency beats intensity with {topic}.',
  'The trick is to make {topic} stupidly easy to start.',
  'Most people quit right here. Do not. Give {topic} just ten focused minutes.',
  'This is where {topic} quietly gets good — protect this habit.',
  'Notice the difference? That is compounding working on {topic}.',
];

const SHORT_TEXT = ['SMALL DAILY WINS', 'MAKE IT EASY', 'DON’T QUIT HERE', 'COMPOUNDING ⚡', 'TEN MINUTES', 'STEP BY STEP'];

const SCENE_VISUALS = [
  'macro shot of everyday objects tied to {topic}, warm light',
  'person mid-action building a {topic} routine',
  'cinematic wide shot, {topic} environment at golden hour',
  'hands arranging tools and notes for {topic}',
  'slow push-in on a screen showing {topic} progress',
];

function pick(list: string[], i: number): string {
  return list[i % list.length];
}

function seededWords(seed: string, list: string[], count: number): string[] {
  const out: string[] = [];
  let i = hashString(seed);
  while (out.length < count) {
    const w = list[i % list.length];
    if (!out.includes(w)) out.push(w);
    i++;
  }
  return out;
}

export interface MockIdeatePayload {
  topic: string;
  seed?: string;
  trends?: { title: string; source: string }[];
}

export function ideate(payload: MockIdeatePayload) {
  const seed = payload.seed ?? payload.topic.toLowerCase();
  const count = 3 + (hashString(seed + 'n') % 2); // 3-4 angles
  const titles = seededWords(seed, ANGLE_HOOKS.map((h) => h.replaceAll('{topic}', payload.topic)), count);
  const hooks = (payload.trends ?? []).slice(0, 3).map((title) => ({ title }));
  return {
    angles: titles.map((title, i) => ({
      id: `angle_${i + 1}`,
      title,
      hook: pick(HOOK_OPENERS, hashString(seed + title)).replaceAll('{topic}', payload.topic),
      angle: pick(ANGLE_POINTS, hashString(seed + title + 'p')) + '.',
      audience: pick(['busy beginners', 'creators', 'self-improvers', 'curious scrollers'], hashString(seed + i)),
      difficulty: (['easy', 'medium', 'hard'] as const)[hashString(seed + title) % 3],
    })),
    hooks: hooks.map((t) => ({
      title: t.title,
      note: 'Trending now — a strong "why now" hook for this idea.',
    })),
  };
}

export interface MockScriptPayload {
  topic: string;
  angleTitle?: string;
  angleHook?: string;
  sceneCount?: number;
  style?: string;
  seed?: string;
}

export function script(payload: MockScriptPayload): { title: string; overview: string; scenes: Scene[] } {
  const topic = payload.topic;
  const seed = payload.seed ?? `${topic}|${payload.angleTitle ?? ''}`.toLowerCase();
  const count = Math.min(7, Math.max(5, payload.sceneCount ?? 6));
  const style = payload.style ?? 'cinematic, high contrast, warm practical light';
  const angleTitle = payload.angleTitle ?? topic;
  const scenes: Scene[] = [];

  const voiceTexts = [
    pick(HOOK_OPENERS, hashString(seed)).replaceAll('{topic}', topic) +
      ' ' + pick(ANGLE_POINTS, hashString(seed + 'p')) + '.',
    ...Array.from({ length: count - 2 }, (_, k) => pick(BEAT_LINES, hashString(seed + k)).replaceAll('{topic}', topic)),
    `If this helped, follow for more on ${topic}, and try one idea today.`,
  ];
  const visuals = [
    `hook frame — ${pick(SCENE_VISUALS, hashString(seed + 'v0')).replaceAll('{topic}', topic)}, quick punchy motion, high energy`,
    ...Array.from({ length: count - 2 }, (_, k) =>
      `${pick(SCENE_VISUALS, hashString(seed + 'v' + (k + 1))).replaceAll('{topic}', topic)}, ${style}, strong composition`),
    `branded ending card with a clear call to action and a ${topic} motif`,
  ];
  const texts = [
    `THE ${topic.toUpperCase().slice(0, 22)} FIX`,
    ...Array.from({ length: count - 2 }, (_, k) => pick(SHORT_TEXT, hashString(seed + 't' + k))),
    'FOLLOW FOR PART 2',
  ];

  for (let i = 0; i < count; i++) {
    scenes.push({
      id: `scene_${i + 1}`,
      visual_description: visuals[i],
      voiceover: voiceTexts[i],
      on_screen_text: texts[i],
      duration_sec: i === 0 ? 4 : i === count - 1 ? 5 : 4 + (hashString(seed + i) % 2),
    });
  }
  return {
    title: toTitleCase(angleTitle.slice(0, 80)),
    overview: `A punchy ${count}-scene short about ${topic}: a hook, a single teachable idea, and a CTA.`,
    scenes,
  };
}

export interface MockMetadataPayload {
  topic: string;
  angleTitle?: string;
  angleHook?: string;
  scriptTitle?: string;
  platform?: PlatformId;
  seed?: string;
}

const PLATFORM_HASHTAGS: Record<string, string[]> = {
  youtube: ['#shorts', '#youtubeshorts'],
  tiktok: ['#fyp', '#foryou'],
  facebook: ['#reels', '#facebookreels'],
  instagram: ['#reels', '#explore'],
};

export function metadataForPlatform(payload: MockMetadataPayload) {
  const platform = payload.platform ?? 'youtube';
  const topicWords = payload.topic.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(/\s+/).slice(0, 4);
  const topicTags = topicWords.map((w) => '#' + w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const baseTags = PLATFORM_HASHTAGS[platform] ?? [];
  const hashtags = [...new Set([...baseTags, ...topicTags])];
  const title = payload.scriptTitle ?? toTitleCase(payload.angleTitle ?? payload.topic).slice(0, 90);
  const hookLine = payload.angleHook ?? `${title} — in 60 seconds.`;
  const description =
    platform === 'youtube'
      ? `${title}\n\n${hookLine}\n\nMore ${payload.topic} content every week. New ideas tested and shared.\n\n${hashtags.join(' ')}`
      : `${hookLine}\n\n${hashtags.join(' ')}`;
  return { platform, title, description, hashtags, thumbnailConcepts: thumbnailConcepts(payload.topic, platform) };
}

function thumbnailConcepts(topic: string, platform: string): string[] {
  const ratio = platform === 'youtube' ? '16:9' : '9:16';
  const t = topic.replace(/[^a-z0-9 ]/gi, '').trim();
  const big = `THE ${t.toUpperCase().slice(0, 16)} FIX`;
  return [
    `[Bold statement · ${ratio}] Close-up subject + giant headline text "${big}", arrow graphic, high contrast`,
    `[Before / after · ${ratio}] Split frame before-vs-after for ${t}, glowing result with a "30 DAYS" badge`,
    `[Face + curiosity · ${ratio}] Expressive face, ${t} visual behind, circled detail, question headline`,
    `[Listicle pop · ${ratio}] Huge number "3" watermark, ${t} objects scattered, vibrant complementary colors`,
  ];
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}

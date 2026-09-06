import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config';
import { logger } from './logger';
import { AppError } from './errors';
import { escapeFFmpegText, splitLines, sleep, hashString } from './util';

// ---------------------------------------------------------------------------
// FFmpeg pipeline for Stage 4 Assembly.
//
// Slideshow fallback path (the reliability backbone): per-scene AI images get
// a Ken Burns pan/zoom, captions (on-screen text) are burned in with the active
// style preset's font/colors, per-scene voiceover is placed on a timeline and
// mixed with an optional generative music bed. Output: 720x1280 MP4 (H.264/AAC).
// True AI-video clips can be dropped in as scene sources later; the same
// timeline logic applies.
// ---------------------------------------------------------------------------

export interface SceneMedia {
  imagePath: string;
  audioPath: string | null;
  caption: string;
  durationSec: number;
  captionColor?: string; // hex accent for the caption block
}

export interface AssembleOpts {
  scenes: SceneMedia[];
  musicPath?: string | null;
  outPath: string;
  width?: number;
  height?: number;
  fps?: number;
  fontPath?: string;
  onProgress?: (pct: number, text: string) => void;
}

export function ffmpegPath(): string {
  if (config.CAS_FFMPEG_PATH) return config.CAS_FFMPEG_PATH;
  const local = path.join(config.apiRoot, '..', '..', '.runtime', 'ffmpeg');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

export function runFfmpeg(args: string[], opts: { timeoutMs?: number; onProgress?: (pct: number, text: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, opts.timeoutMs ?? 600_000);
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (opts.onProgress) {
        const m = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
        if (m?.length) {
          const last = m[m.length - 1];
          const [, h, min, s] = /time=(\d+):(\d+):([\d.]+)/.exec(last) ?? [];
          if (h !== undefined) {
            const total = parseFloat(h) * 3600 + parseFloat(min) * 60 + parseFloat(s);
            opts.onProgress(total, 'encoding');
          }
        }
      }
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || killed === false && code === 0) resolve({ stdout, stderr });
      else {
        reject(new AppError({
          code: 'PROVIDER_UNAVAILABLE',
          userMessage: 'Video assembly failed while encoding.',
          suggestion: 'Try again — your scene assets are untouched.',
          message: `ffmpeg exited ${code}: ${tail(stderr, 1200)}`,
        }));
      }
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        userMessage: 'FFmpeg is not available on this machine.',
        suggestion: 'Install FFmpeg or set CAS_FFMPEG_PATH.',
        message: e.message,
      }));
    });
  });
}

const tail = (s: string, n: number) => (s.length > n ? '…' + s.slice(-n) : s);

/** Probe media duration in seconds via ffprobe-style -i parse. */
export async function mediaDuration(file: string): Promise<number> {
  const args = ['-i', file];
  try {
    const { stderr } = await runFfmpeg(args, { timeoutMs: 20_000 });
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { /* probe errors are fine */ }
  return 0;
}

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

const W = 720;
const H = 1280;
const FPS = 30;

function zoomFilter(sceneIndex: number, frames: number): string {
  // alternate slow push-in / pull-out with a gentle lateral drift
  if (sceneIndex % 2 === 0) {
    return `zoompan=z='min(zoom+0.0009,1.16)':d=${frames}:x='iw/2-(iw/zoom/2)+10*sin(on/45)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`;
  }
  return `zoompan=z='if(lte(on,1),1.16,max(zoom-0.0009,1.0))':d=${frames}:x='iw/2-(iw/zoom/2)+8*sin(on/40+1)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`;
}

// Captions are burned with libass (the `subtitles` filter — this sandbox's
// static FFmpeg build ships libass but no drawtext/freetype).
const FONTS_DIR = '/usr/share/fonts/truetype/dejavu';

function assTimestamp(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function assEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, ' ')
    .replace(/\(?!\)/g, '')
    .trim();
}

/** One timed ASS caption file for the whole timeline (libass burns it in). */
function writeAssCaptions(scenes: SceneMedia[], outDir: string): string {
  const f = path.join(outDir, `caps_${Date.now()}.ass`);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8C000000,-1,0,0,0,100,100,0,0,3,2,0,2,40,40,110,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  let t = 0;
  const events: string[] = [];
  for (const sc of scenes) {
    const start = t;
    const end = t + sc.durationSec;
    const lines = splitLines(sc.caption, 22).map((l) => l.toUpperCase());
    const text = lines.map((l) => assEscape(l)).join('\\N');
    if (text) {
      events.push(`Dialogue: 0,${assTimestamp(start)},${assTimestamp(end)},Caption,,0,0,0,,${text}`);
    }
    t = end;
  }
  fs.writeFileSync(f, header + events.join('\n') + '\n');
  return f;
}

/**
 * Assemble scenes (Ken Burns images + captions + voiceover) into one MP4.
 * Throws an AppError with a friendly message when encoding fails.
 */
export async function assembleSlideshow(opts: AssembleOpts): Promise<{ durationSec: number }> {
  const outDir = path.dirname(opts.outPath);
  fs.mkdirSync(outDir, { recursive: true });
  const scenes = opts.scenes;
  const totalSec = scenes.reduce((s, x) => s + x.durationSec, 0);
  const totalFramesTotal = Math.round(totalSec * FPS);

  const inputs: string[] = [];
  for (const sc of scenes) {
    inputs.push('-loop', '1', '-t', String(sc.durationSec), '-i', sc.imagePath);
  }
  const audioScenes = scenes.map((s) => s.audioPath).filter(Boolean) as string[];
  const audioInputCount = audioScenes.length;
  for (const a of audioScenes) inputs.push('-i', a);
  let musicInputIndex = -1;
  if (opts.musicPath && fs.existsSync(opts.musicPath)) {
    inputs.push('-i', opts.musicPath);
    musicInputIndex = scenes.length + audioInputCount;
  }

  const fc: string[] = [];
  const vLabels: string[] = [];
  let audioIndex = scenes.length;

  scenes.forEach((sc, i) => {
    const label = `v${i}`;
    const frames = Math.max(2, Math.round(sc.durationSec * FPS));
    fc.push(
      `[${i}:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,${zoomFilter(i, frames)},format=yuv420p[${label}]`,
    );
    vLabels.push(`[${label}]`);
  });

  // concat video, then burn captions over the whole timeline with libass
  fc.push(`${vLabels.join('')}concat=n=${scenes.length}:v=1:a=0[vc]`);
  const assPath = writeAssCaptions(scenes, outDir);
  fc.push(`[vc]subtitles=${assPath}:fontsdir=${FONTS_DIR}[vsub]`);

  // per-scene accent underline (style-preset accent color, timed per scene)
  let vCur = 'vsub';
  let sceneCursor = 0;
  scenes.forEach((sc, i) => {
    const accent = (sc.captionColor ?? '#1f8a70').replace('#', '');
    const st = sceneCursor;
    const en = sceneCursor + Math.max(0.4, sc.durationSec - 0.15);
    sceneCursor += sc.durationSec;
    if (!accent || accent.length !== 6) return;
    const next = `vu${i}`;
    fc.push(
      `[${vCur}]drawbox=x=w/2-90:y=1190:w=180:h=7:color=0x${accent}@0.95:t=fill:enable='between(t,${st.toFixed(3)},${en.toFixed(3)})'[${next}]`,
    );
    vCur = next;
  });
  fc.push(`[${vCur}]format=yuv420p[vout]`);

  // audio timeline: place each voiceover at its scene start
  const mixInputs: string[] = [];
  let cursor = 0;
  audioScenes.forEach((_a, i) => {
    const scene = scenes[i];
    if (!scene.audioPath) return;
    const delayMs = Math.round(cursor * 1000);
    const durMs = Math.round(scene.durationSec * 1000);
    const src = `[${audioIndex}:a]`;
    audioIndex++;
    const label = `ad${i}`;
    fc.push(
      `${src}aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad=whole_dur=${totalSec.toFixed(2)}[${label}]`,
    );
    mixInputs.push(`[${label}]`);
    void durMs;
    cursor += scene.durationSec;
  });

  if (musicInputIndex >= 0) {
    const label = 'mus';
    fc.push(
      `[${musicInputIndex}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.16,apad=whole_dur=${totalSec.toFixed(2)}[${label}]`,
    );
    mixInputs.push(`[${label}]`);
  }

  if (mixInputs.length > 0) {
    fc.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0,atrim=0:${totalSec.toFixed(2)},afade=t=out:st=${Math.max(0, totalSec - 0.4)}:d=0.4[aout]`);
  } else {
    fc.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${totalSec.toFixed(2)}[aout]`);
  }

  const args = ['-y', ...inputs, '-filter_complex', fc.join(';')];
  args.push(
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', totalSec.toFixed(3),
    '-movflags', '+faststart',
    opts.outPath,
  );

  logger.info(`[ffmpeg] assembling ${scenes.length} scenes, ${totalSec.toFixed(1)}s total…`);
  const startedAt = Date.now();
  let lastPct = 0;
  await runFfmpeg(args, {
    timeoutMs: 15 * 60_000,
    onProgress: (sec, _txt) => {
      const pct = Math.min(99, Math.round((sec / totalSec) * 100));
      if (pct > lastPct) {
        lastPct = pct;
        opts.onProgress?.(pct, `Encoding scene ${Math.min(scenes.length, Math.floor((sec / totalSec) * scenes.length) + 1)} of ${scenes.length}…`);
      }
    },
  });
  logger.info(`[ffmpeg] assembly done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  const durationSec = totalSec;
  void totalFramesTotal;
  return { durationSec };
}

// ---------------------------------------------------------------------------
// Generative music bed — a soft synth "pad" so demo videos are not silent.
// Root note varies by seed. Best-effort: failures return null (assembly
// continues without a music bed).
// ---------------------------------------------------------------------------
const ROOTS: Record<string, number> = { a: 110, c: 130.81, d: 146.83, e: 164.81, f: 174.61, g: 196 };

export async function composeAmbientPad(seed: string, durationSec: number, outPath: string): Promise<string | null> {
  const rootName = ['a', 'c', 'd', 'e', 'f', 'g'][hashString(seed) % 6];
  const root = ROOTS[rootName];
  const third = root * 1.25; // just-ish major third
  const fifth = root * 1.5;
  const oct = root * 2;
  const dur = Math.max(4, durationSec + 2);
  const fadeOutSt = Math.max(0, dur - 2.5);
  const expr = [
    `0.5*sin(2*PI*${root.toFixed(2)}*t)*(0.62+0.38*sin(2*PI*0.11*t))`,
    `0.4*sin(2*PI*${third.toFixed(2)}*t)*(0.62+0.38*sin(2*PI*0.13*t+1.2))`,
    `0.38*sin(2*PI*${fifth.toFixed(2)}*t)*(0.6+0.4*sin(2*PI*0.09*t+2.4))`,
    `0.18*sin(2*PI*${oct.toFixed(2)}*t)*(0.5+0.5*sin(2*PI*0.17*t+0.6))`,
  ].join('+');
  try {
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=${dur.toFixed(2)}`,
      '-af', `lowpass=f=900,afade=t=in:d=2,afade=t=out:st=${fadeOutSt.toFixed(2)}:d=2.5`,
      '-c:a', 'pcm_s16le', outPath,
    ], { timeoutMs: 120_000 });
    return outPath;
  } catch (e) {
    logger.warn('Music bed generation failed — continuing without music.', e);
    return null;
  }
}

export async function probeAndTrimAudio(file: string): Promise<string> {
  void file;
  await sleep(1);
  return file;
}

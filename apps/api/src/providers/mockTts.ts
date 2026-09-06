// Local text-to-speech via eSpeak-NG compiled to WASM (works offline, no key).
// Each call initializes an emscripten instance with CLI args and reads the
// resulting 22.05kHz mono WAV out of its virtual FS.
// (GPL-3.0 — dev/demo dependency; swap for a licensed TTS provider in prod.)
import { clamp } from '../util';

let factoryPromise: Promise<(opts?: Record<string, unknown>) => Promise<any>> | null = null;

async function factory(): Promise<(opts?: Record<string, unknown>) => Promise<any>> {
  if (!factoryPromise) {
    factoryPromise = import('espeak-ng').then((m) => m.default);
  }
  return factoryPromise;
}

export interface TtsResult {
  wav: Buffer;
  durationSec: number;
  sampleRate: number;
  wpm: number;
}

async function synthOnce(voiceArg: string, wpm: number, text: string): Promise<{ wav: Buffer; durationSec: number; sampleRate: number }> {
  const make = await factory();
  const dir = '/cas_tts';
  const file = `s_${Date.now()}_${Math.floor(Math.random() * 1e9)}.wav`;
  const mod = await make({
    noExitRuntime: true,
    print: () => {},
    printErr: () => {},
    preRun: [(m: any) => { try { m.FS.mkdir(dir); } catch { /* exists */ } }],
    arguments: ['-w', `${dir}/${file}`, '-v', voiceArg, '-s', String(wpm), text],
  });
  const data = Buffer.from(mod.FS.readFile(`${dir}/${file}`));
  const sampleRate = 22050;
  return { wav: data, durationSec: data.length / (sampleRate * 2), sampleRate };
}

export async function speak(text: string, opts: { voice?: string; speed?: number; maxSec?: number } = {}): Promise<TtsResult> {
  const voice = opts.voice ?? 'en-us';
  const voiceArg = voice === 'en' || voice.startsWith('en-') ? voice : 'en-us';
  const cleanText = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/[^\x20-\x7E\u00C0-\u024F]/g, '')
    .trim();
  let wpm = opts.speed ?? 165;
  const maxSec = opts.maxSec ?? 0;
  let last: { wav: Buffer; durationSec: number; sampleRate: number } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    last = await synthOnce(voiceArg, wpm, cleanText || '…');
    if (maxSec > 0 && last.durationSec > maxSec && attempt < 3) {
      wpm = clamp(Math.round((wpm * last.durationSec) / maxSec), 170, 420);
      continue;
    }
    return { ...last, wpm };
  }
  return { ...last!, wpm: 420 };
}

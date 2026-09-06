import { customAlphabet, nanoid } from 'nanoid';

const idAlphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
export const makeId = (prefix: string, size = 18) => `${prefix}_${customAlphabet(idAlphabet, size)()}`;

export { nanoid };

export const nowIso = () => new Date().toISOString();

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export const daysAgoIso = (days: number, from = new Date()) =>
  new Date(from.getTime() - days * 86_400_000).toISOString();

// Deterministic string hash (FNV-1a) — used to pick templates/colors so the
// mock provider feels varied but reproducible per seed.
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickSeeded<T>(seed: string, arr: T[]): T {
  return arr[hashString(seed) % arr.length];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function escapeFFmpegText(s: string): string {
  // text goes inside single quotes in filtergraph; escape \ ' and colons
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

export function splitLines(text: string, maxLen = 26): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxLen && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.slice(0, 3);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

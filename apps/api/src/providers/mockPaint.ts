// Mock image painter — deterministic "demo poster" generator used by the mock
// image provider. Pure-JS PNG via node:zlib (no native deps).
import { encodePng } from '../util/png';
import { hashString, clamp, hexToRgb } from '../util';

export const PALETTES: Record<string, { name: string; colors: string[] }> = {
  teal: { name: 'Deep Teal', colors: ['#0b2e2a', '#0f4c44', '#1f8a70', '#7fd8be', '#ffe8a3', '#0a1f1c'] },
  sunset: { name: 'Sunset Pop', colors: ['#1b1035', '#5b2a86', '#e0527d', '#ff9470', '#ffd166', '#2a1654'] },
  aurora: { name: 'Aurora', colors: ['#062b3c', '#0f5c68', '#31b6a0', '#9ff3df', '#3c6e71', '#04212e'] },
  mono: { name: 'Studio Noir', colors: ['#0c0c0e', '#232329', '#4a4a55', '#e6e6ea', '#f6f6f8', '#111114'] },
  candy: { name: 'Candy Pop', colors: ['#2d0a3d', '#8a2be2', '#ff4f9a', '#ffd447', '#7ef0ff', '#1d0628'] },
};

export interface PainterOpts {
  seed: string;
  paletteKey?: string;
  colors?: string[];
  width?: number;
  height?: number;
  variant?: number;
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export function paintPoster(opts: PainterOpts): Buffer {
  const W = opts.width ?? 720;
  const H = opts.height ?? 1280;
  const colors = opts.colors ?? PALETTES[opts.paletteKey ?? 'teal'].colors;
  const rgb = Buffer.alloc(W * H * 3);
  const setPx = (x: number, y: number, c: [number, number, number], a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    if (a >= 1) {
      rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
    } else {
      rgb[i] = Math.round(rgb[i] * (1 - a) + c[0] * a);
      rgb[i + 1] = Math.round(rgb[i + 1] * (1 - a) + c[1] * a);
      rgb[i + 2] = Math.round(rgb[i + 2] * (1 - a) + c[2] * a);
    }
  };

  const rng = mulberry32(hashString(opts.seed));
  const [cDark, cDark2, cMid, cAcc, cLight] = colors.map(hexToRgb);
  const variant = opts.variant ?? 0;

  // diagonal gradient background
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const row = mix(cDark, cDark2, t);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const d = (x / W + y / H) / 2;
      const c = mix(row, cMid, d * 0.35);
      rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
    }
  }

  const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const fillCircle = (cx: number, cy: number, r: number, col: [number, number, number], alpha = 1) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const a = d2 > r2 * 0.72 ? clamp((r - Math.sqrt(d2)) / (r * 0.15), 0, 1) * alpha : alpha;
          setPx(x, y, col, a);
        }
      }
    }
  };
  const ring = (cx: number, cy: number, r: number, thick: number, col: [number, number, number], alpha = 0.9) => {
    const x0 = Math.max(0, Math.floor(cx - r - thick)), x1 = Math.min(W - 1, Math.ceil(cx + r + thick));
    const y0 = Math.max(0, Math.floor(cy - r - thick)), y1 = Math.min(H - 1, Math.ceil(cy + r + thick));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d >= r && d <= r + thick) setPx(x, y, col, alpha * clamp((r + thick - d) / 2, 0, 1));
      }
    }
  };
  const waves = (baseY: number, amp: number, freq: number, thick: number, col: [number, number, number], phase: number, alpha = 0.5) => {
    for (let y = Math.max(0, Math.floor(baseY - amp - thick)); y < Math.min(H, Math.ceil(baseY + amp + thick)); y++) {
      for (let x = 0; x < W; x++) {
        const yy = baseY + Math.sin((x / W) * Math.PI * 2 * freq + phase) * amp;
        const d = Math.abs(y - yy);
        if (d < thick) setPx(x, y, col, alpha * (1 - d / thick));
      }
    }
  };

  const sunR = W * rand(0.28, 0.45);
  fillCircle(W * rand(0.25, 0.75), H * rand(0.16, 0.3), sunR, cAcc, 0.9);
  fillCircle(W * rand(0.3, 0.7), H * rand(0.12, 0.34), sunR * 0.55, cLight, 0.55);

  if (variant % 3 === 0) {
    waves(H * (0.72 + rand(-0.03, 0.03)), 70, 1.6, 26, cMid, rand(0, 6.28), 0.8);
    waves(H * 0.86, 46, 2.2, 34, cDark2, rand(0, 6.28), 0.9);
  } else if (variant % 3 === 1) {
    for (let i = 0; i < 4; i++) {
      ring(W * rand(0.1, 0.9), H * rand(0.35, 0.95), rand(30, 140), rand(4, 12), i % 2 ? cMid : cAcc, 0.8);
    }
  } else {
    for (let i = 0; i < 26; i++) {
      const x = ((i * 97) % W) + Math.sin(i * 3.7) * 40;
      const y = H * 0.45 + ((i * 53) % Math.round(H * 0.5));
      fillCircle(x, y, rand(3, 11), i % 3 === 0 ? cLight : cMid, 0.9);
    }
  }

  // bottom accent bar + floating dots
  for (let y = H - 26; y < H; y++) for (let x = 0; x < W; x++) setPx(x, y, cAcc, 0.9);
  for (let i = 0; i < 14; i++) fillCircle(rand(0, W), rand(0, H), rand(1.5, 5), i % 2 ? cLight : cAcc, 0.85);
  // frame vignette
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 3) {
      const d = Math.max(x / W, (W - x) / W, y / H, (H - y) / H) - 0.55;
      if (d > 0) setPx(x, y, [0, 0, 0], clamp(d * 0.9, 0, 0.55));
    }
  }
  return encodePng(W, H, rgb);
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

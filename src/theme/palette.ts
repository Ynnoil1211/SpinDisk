import type { DeskTexture } from '../core/types.js';
/**
 * Motor cromático "Tierra y Pastel".
 *
 * Extrae la paleta de la portada y la reescribe dentro de un jardín cerrado de
 * tonos: arena, crema, terracota suave, verde salvia, azul lavado, gris cálido.
 * Ninguna portada neón puede romper la calma visual de la mesa.
 */

export interface Palette {
  /** Fondo: degradado cálido de la mesa. */
  deskLight: string;
  deskDark: string;
  /** Sombra proyectada sobre la mesa. */
  shadow: string;
  /** Cartón de la funda cuando no hay portada. */
  paper: string;
  paperEdge: string;
  /** Tinta cálida para textos impresos. */
  ink: string;
  accent: string;
  /** Vetas del vinilo marmoleado. */
  marbleBase: string;
  marbleLight: string;
  marbleDark: string;
  marbleVein: string;
  /** Galleta / etiqueta central. */
  labelPaper: string;
  labelInk: string;
  labelAccent: string;
  /** Reflejo especular sobre el plástico. */
  sheen: string;
  dark: boolean;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const ANCHORS = [14, 30, 42, 52, 78, 104, 128, 168, 198, 222, 258, 340];

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const snapHue = (h: number, strength = 0.72): number => {
  let best = ANCHORS[0];
  let bestD = 360;
  for (const a of ANCHORS) {
    const d = hueDistance(h, a);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  // Interpolación circular hacia el ancla elegida.
  let delta = ((best - h + 540) % 360) - 180;
  return (h + delta * strength + 360) % 360;
};

export const rgbToHsl = (r: number, g: number, b: number): Hsl => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
};

export const hsl = (h: number, s: number, l: number, alpha = 1): string => {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.round(clamp01(s) * 1000) / 10;
  const ll = Math.round(clamp01(l) * 1000) / 10;
  return alpha >= 1 ? `hsl(${hh.toFixed(1)} ${ss}% ${ll}%)` : `hsl(${hh.toFixed(1)} ${ss}% ${ll}% / ${alpha})`;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const warmGrey: Hsl = { h: 36, s: 0.16, l: 0.78 };

export const defaultPalette = (): Palette => buildPalette([
  { h: 22, s: 0.38, l: 0.55 },
  { h: 42, s: 0.32, l: 0.68 },
  { h: 150, s: 0.14, l: 0.52 },
]);

/** Convierte tonos crudos en la paleta doméstica de la app. */
export const buildPalette = (raw: Hsl[]): Palette => {
  const seeds = raw.length > 0 ? raw : [warmGrey];
  const primary = seeds[0] ?? warmGrey;
  const secondary = seeds[1] ?? primary;
  const tertiary = seeds[2] ?? secondary;

  const h1 = snapHue(primary.h, 0.8);
  const h2 = snapHue(secondary.h, 0.7);
  const h3 = snapHue(tertiary.h, 0.65);

  const baseL = clamp01(primary.l);
  const earth = Math.min(0.5, Math.max(0.2, Math.abs(baseL - 0.5) * 0.6));
  const deskH = snapHue((h1 * 2 + 42) / 3, 0.9);

  return {
    deskLight: hsl(deskH + 6, 0.20 + earth * 0.16, 0.90 - earth * 0.04),
    deskDark: hsl(deskH - 2, 0.17 + earth * 0.15, 0.72 - earth * 0.06),
    shadow: `rgba(${52 + earth * 20}, ${40 + earth * 12}, ${29 + earth * 8}, 0.30)`,
    paper: hsl(h2, 0.14, 0.84),
    paperEdge: hsl(h2, 0.16, 0.70),
    ink: hsl(26, 0.22, 0.22),
    accent: hsl(snapHue(h3, 0.6), 0.38, 0.46),
    marbleBase: hsl(h1, 0.20, 0.66),
    marbleLight: hsl(h1 + 4, 0.16, 0.84),
    marbleDark: hsl(h1 - 6, 0.24, 0.40),
    marbleVein: hsl(h2, 0.18, 0.58),
    labelPaper: hsl(43, 0.32, 0.93),
    labelInk: hsl(28, 0.24, 0.20),
    labelAccent: hsl(h3, 0.42, 0.45),
    sheen: 'rgba(255, 252, 244, 0.55)',
    dark: false,
  };
};

const coverCache = new Map<string, Palette>();

/**
 * Extrae colores de la portada. Necesita que la imagen sea CORS-safe
 * (`crossOrigin="anonymous"`), si no el canvas queda contaminado.
 */
export const paletteFromImage = (img: HTMLImageElement): Palette => {
  const key = img.currentSrc || img.src;
  const cached = coverCache.get(key);
  if (cached) return cached;

  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !img.naturalWidth || !img.naturalHeight) return defaultPalette();

  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    const fallback = defaultPalette();
    coverCache.set(key, fallback);
    return fallback;
  }

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luma > 0.965 || luma < 0.05) continue;
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(k);
    if (entry) {
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.n += 1;
    } else {
      buckets.set(k, { r, g, b, n: 1 });
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const raw: Hsl[] = [];
  for (const entry of sorted) {
    const hslv = rgbToHsl(entry.r / entry.n, entry.g / entry.n, entry.b / entry.n);
    // Evita repetir casi el mismo tono dos veces.
    if (raw.some((p) => hueDistance(p.h, hslv.h) < 24 && Math.abs(p.l - hslv.l) < 0.16)) continue;
    raw.push(hslv);
    if (raw.length === 3) break;
  }
  while (raw.length < 3) raw.push(raw[raw.length - 1] ?? warmGrey);

  const palette = buildPalette(raw);
  coverCache.set(key, palette);
  return palette;
};

/** Aplica la paleta al documento para que el panel y el sandbox la hereden. */
export const applyPaletteToCss = (palette: Palette, deskTexture: DeskTexture = 'album'): void => {
  const style = document.documentElement.style;
  let light = palette.deskLight;
  let dark = palette.deskDark;
  if (deskTexture === 'wood') {
    light = '#362a20';
    dark = '#211812';
  } else if (deskTexture === 'sand') {
    light = '#e5dbd0';
    dark = '#c9bcae';
  } else if (deskTexture === 'slate') {
    light = '#282523';
    dark = '#171514';
  } else if (deskTexture === 'sage') {
    light = '#454e46';
    dark = '#2d352e';
  }
  style.setProperty('--paper', light);
  style.setProperty('--paper-deep', dark);
  style.setProperty('--ink', palette.ink);
  style.setProperty('--accent', palette.accent);
  style.setProperty('--panel', hsl(40, 0.24, 0.94, 0.82));
  style.setProperty('--panel-ink', palette.ink);
  style.setProperty('--hairline', hsl(35, 0.16, 0.55, 0.28));
  style.setProperty('--card', palette.labelPaper);
};

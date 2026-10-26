/**
 * El vinilo: resina marmoleada girando bajo una capa de surcos y reflejos que
 * no gira (así la luz de la habitación parece quedarse quieta).
 */

import type { Palette } from '../theme/palette.js';
import { hsl } from '../theme/palette.js';
import type { DiscTexture } from '../core/types.js';
import { makeMarbleTexture, makeSurface, roundRectPath, drawCurvedText, wrapText } from '../render/canvas.js';

const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const SANS = '"Helvetica Neue", "Segoe UI", system-ui, sans-serif';
const MONO = '"SF Mono", "Cascadia Mono", "Roboto Mono", monospace';

export interface DiscState {
  cx: number;
  cy: number;
  r: number;
  spin: number;
  texture: DiscTexture;
  seed: number;
  palette: Palette;
  title: string;
  artist: string;
  album: string;
  rpm: number;
  side: string;
  opacity: number;
}

const textureCache = new Map<string, HTMLCanvasElement>();
const MAX_TEXTURES = 5;

const textureKey = (state: DiscState): string =>
  `${state.texture}|${state.seed}|${state.palette.marbleBase}|${state.palette.marbleVein}`;

const marbleColors = (palette: Palette) => ({
  base: palette.marbleBase,
  light: palette.marbleLight,
  dark: palette.marbleDark,
  vein: palette.marbleVein,
});

const getTexture = (state: DiscState): HTMLCanvasElement => {
  const key = textureKey(state);
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = makeMarbleTexture(marbleColors(state.palette), 512, state.seed + 1, state.texture);
  if (textureCache.size >= MAX_TEXTURES) {
    const oldest = textureCache.keys().next().value;
    if (oldest) textureCache.delete(oldest);
  }
  textureCache.set(key, canvas);
  return canvas;
};

export const clearTextureCache = (): void => textureCache.clear();

/** Capa fija: surcos, bisel y reflejo especular. No rota. */
const overlayCache = new Map<string, HTMLCanvasElement>();

const getOverlay = (radius: number, palette: Palette, kind: DiscTexture): HTMLCanvasElement => {
  const key = `${Math.round(radius)}|${kind}|${palette.marbleDark}`;
  const cached = overlayCache.get(key);
  if (cached) return cached;

  const size = Math.ceil(radius * 2 * 2); // 2× para pantallas densas
  const surface = makeSurface(size, size);
  const { ctx } = surface;
  const c = size / 2;
  const R = size / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.clip();

  const lightAlpha = kind === 'black' ? 0.16 : 0.10;
  const darkAlpha = kind === 'cream' ? 0.05 : 0.08;

  // Surcos: anillos muy finos, más cerrados hacia el borde.
  const rings = 110;
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const rr = R * (0.34 + 0.655 * t);
    ctx.beginPath();
    ctx.arc(c, c, rr, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0
      ? `rgba(255,255,255,${lightAlpha * (0.6 + 0.4 * t)})`
      : `rgba(28,20,12,${darkAlpha * (0.5 + 0.5 * t)})`;
    ctx.lineWidth = Math.max(0.6, size / 1400);
    ctx.stroke();
  }

  // Reflejo diagonal: dos bandas anchas y una línea de brillo.
  ctx.globalCompositeOperation = 'screen';
  const sheen = ctx.createLinearGradient(R * 0.1, R * 0.95, R * 1.5, R * 0.05);
  sheen.addColorStop(0, 'rgba(255,250,240,0)');
  sheen.addColorStop(0.34, 'rgba(255,250,240,0.05)');
  sheen.addColorStop(0.42, 'rgba(255,252,246,0.30)');
  sheen.addColorStop(0.47, 'rgba(255,252,246,0.05)');
  sheen.addColorStop(0.62, 'rgba(255,250,240,0.02)');
  sheen.addColorStop(0.70, 'rgba(255,252,246,0.22)');
  sheen.addColorStop(0.74, 'rgba(255,250,240,0.02)');
  sheen.addColorStop(1, 'rgba(255,250,240,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  // Bisel del borde y sombra interior.
  const rim = ctx.createRadialGradient(c, c, R * 0.86, c, c, R);
  rim.addColorStop(0, 'rgba(30,22,14,0)');
  rim.addColorStop(0.82, 'rgba(30,22,14,0.10)');
  rim.addColorStop(1, 'rgba(30,22,14,0.45)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(c, c, R - size / 700, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,252,244,0.34)';
  ctx.lineWidth = size / 340;
  ctx.stroke();
  ctx.restore();

  if (overlayCache.size > 3) {
    const oldest = overlayCache.keys().next().value;
    if (oldest) overlayCache.delete(oldest);
  }
  overlayCache.set(key, surface.canvas);
  return surface.canvas;
};

export const drawDiscShadow = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  palette: Palette,
): void => {
  ctx.save();
  ctx.translate(cx + r * 0.06, cy + r * 0.08);
  ctx.scale(1, 0.97);
  const grad = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r * 1.08);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.62, hexToRgba(palette.shadow, 0.35));
  grad.addColorStop(0.9, hexToRgba(palette.shadow, 0.6));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const hexToRgba = (color: string, alpha: number): string => {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(color);
  if (!match) return `rgba(60,48,36,${alpha})`;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
};

/** Galleta central: papel impreso que gira solidariamente con el disco. */
const drawLabel = (ctx: CanvasRenderingContext2D, state: DiscState): void => {
  const { r, palette } = state;
  const labelR = r * (86 / 258);
  const paper = palette.labelPaper;

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, labelR, 0, Math.PI * 2);
  const paperGrad = ctx.createRadialGradient(-labelR * 0.3, -labelR * 0.4, labelR * 0.1, 0, 0, labelR);
  paperGrad.addColorStop(0, hsl(42, 0.30, 0.96));
  paperGrad.addColorStop(1, paper);
  ctx.fillStyle = paperGrad;
  ctx.fill();

  // Aro de tinta y sombra del borde del papel.
  ctx.strokeStyle = 'rgba(70,52,34,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, labelR, 0, Math.PI * 2);
  ctx.clip();

  const ink = palette.labelInk;
  const accent = palette.labelAccent;

  // Título en la mitad superior.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.font = `600 ${r * 0.062}px ${SERIF}`;
  const titleLines = wrapText(ctx, state.title || 'Sin título', labelR * 1.42, 2);
  const titleTop = -labelR * (titleLines.length > 1 ? 0.42 : 0.3);
  titleLines.forEach((line, i) => {
    ctx.fillText(line, 0, titleTop + i * r * 0.062, labelR * 1.45);
  });

  // Artista en la mitad inferior.
  ctx.fillStyle = hsl(30, 0.18, 0.30);
  ctx.font = `600 ${r * 0.032}px ${SANS}`;
  ctx.fillText((state.artist || 'Artista desconocido').toUpperCase(), 0, labelR * 0.30, labelR * 1.5);

  // Código de barras estilizado.
  const barY = labelR * 0.50;
  const bars = 26;
  let x = -labelR * 0.30;
  ctx.fillStyle = 'rgba(38,28,18,0.72)';
  for (let i = 0; i < bars; i++) {
    const w = (i * 7) % 5 === 0 ? r * 0.0075 : r * 0.0042;
    const h = labelR * 0.13 + ((i * 3) % 4) * 0.5;
    ctx.fillRect(x, barY - h / 2, w, h);
    x += w + r * 0.0045;
  }

  // Textos legales curvos.
  drawCurvedText(ctx, 'SPINDISK · TODOS LOS DERECHOS RESERVADOS', 0, 0, labelR * 0.86, -Math.PI / 2, {
    font: `500 ${r * 0.024}px ${SANS}`,
    color: 'rgba(48,36,24,0.62)',
  });
  drawCurvedText(ctx, `${state.side} · ${state.rpm === 45 ? '45' : '33⅓'} RPM · ESTÉREO`, 0, 0, labelR * 0.84, Math.PI / 2, {
    font: `500 ${r * 0.024}px ${SANS}`,
    color: 'rgba(48,36,24,0.62)',
    flip: true,
  });

  // Marca de agua del álbum, tenue.
  if (state.album) {
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = accent;
    ctx.font = `italic ${r * 0.023}px ${MONO}`;
    ctx.fillText(state.album.slice(0, 26), 0, -labelR * 0.72, labelR * 1.5);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Orificio del eje.
  ctx.beginPath();
  ctx.arc(0, 0, r * (6.5 / 258), 0, Math.PI * 2);
  ctx.fillStyle = '#15110c';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-r * 0.0012, -r * 0.0012, r * (6.5 / 258) * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0906';
  ctx.fill();
  ctx.restore();
};

export const drawDisc = (ctx: CanvasRenderingContext2D, state: DiscState): void => {
  const { cx, cy, r } = state;
  const texture = getTexture(state);

  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.translate(cx, cy);

  // Cuerpo.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  if (state.texture === 'glass') {
    ctx.fillStyle = 'rgba(228,236,238,0.55)';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.globalAlpha = state.opacity * 0.8;
  }
  ctx.rotate(state.spin);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(texture, -r, -r, r * 2, r * 2);
  ctx.restore();

  // Galleta.
  ctx.save();
  ctx.rotate(state.spin);
  drawLabel(ctx, state);
  ctx.restore();

  // Capa fija de surcos y luz.
  ctx.drawImage(getOverlay(r, state.palette, state.texture), -r, -r, r * 2, r * 2);

  // Borde exterior.
  ctx.beginPath();
  ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,252,244,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
};

/** Sombra suave de la aguja y el cabezal sobre el surco. */
export const drawNeedleShadow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
): void => {
  ctx.save();
  ctx.translate(x + 7, y + 9);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(20,14,8,0.26)';
  roundRectPath(ctx, -6, -4, 26, 10, 4);
  ctx.fill();
  ctx.restore();
};

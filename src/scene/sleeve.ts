/**
 * La funda de cartón: anverso impreso y reverso con liner notes.
 *
 * Se pre-renderiza en sprites para que el frame sólo tenga que estamparlos.
 */

import type { Palette } from '../theme/palette.js';
import { hsl } from '../theme/palette.js';
import type { Lyrics } from '../bridge/lyrics.js';
import { drawCoverFit, makeGrainTile, makeSurface, roundRectPath, wrapText } from '../render/canvas.js';
import { formatTime, hashString } from '../util/math.js';

const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const SANS = '"Helvetica Neue", "Segoe UI", system-ui, sans-serif';

let grainTile: HTMLCanvasElement | null = null;
const getGrain = (): HTMLCanvasElement => {
  if (!grainTile) grainTile = makeGrainTile(128, 0.1, 19);
  return grainTile;
};

const drawPaper = (
  ctx: CanvasRenderingContext2D,
  size: number,
  base: string,
  strength = 1,
): void => {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.globalAlpha = 0.5 * strength;
  const pattern = ctx.createPattern(getGrain(), 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
};

const drawEdgeWear = (ctx: CanvasRenderingContext2D, size: number): void => {
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, 'rgba(255,252,244,0.16)');
  grad.addColorStop(0.45, 'rgba(255,252,244,0)');
  grad.addColorStop(1, 'rgba(46,34,22,0.14)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255,250,240,0.20)';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, 1.2, 1.2, size - 2.4, size - 2.4, 3);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(48,36,24,0.28)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, 0.5, 0.5, size - 1, size - 1, 3);
  ctx.stroke();
};

/** Anverso: la carátula, mate, con el lomo de cartón a la izquierda. */
export const makeSleeveFront = (
  size: number,
  dpr: number,
  palette: Palette,
  cover: HTMLImageElement | null,
  title: string,
  artist: string,
): HTMLCanvasElement => {
  const surface = makeSurface(size, size, dpr);
  const { ctx } = surface;

  drawPaper(ctx, size, palette.paper);
  if (cover) {
    drawCoverFit(ctx, cover, 0, 0, size, size);
    // Impresión mate: se baja un punto la saturación y se calienta el papel.
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    ctx.fillStyle = 'rgba(244,234,214,0.07)';
    ctx.fillRect(0, 0, size, size);
  } else {
    // Funda vacía: cartón con la marca en relieve, sin carátula todavía.
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, palette.paper);
    grad.addColorStop(1, palette.paperEdge);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mark = size * 0.042;
    const cx = size / 2;
    const cy = size * 0.5;
    // Relieve: sombra clara arriba y tinta hundida debajo.
    for (const [dy, color] of [
      [-1.1, 'rgba(255,252,244,0.55)'],
      [1.1, 'rgba(46,34,22,0.16)'],
      [0, 'rgba(58,44,30,0.42)'],
    ] as const) {
      ctx.fillStyle = color;
      ctx.font = `500 ${mark}px ${SERIF}`;
      ctx.letterSpacing = '0.42em';
      ctx.fillText('SPINDISK', cx + mark * 0.21, cy + dy);
    }
    ctx.letterSpacing = '0';
    ctx.strokeStyle = 'rgba(58,44,30,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.15, cy + mark * 1.6);
    ctx.lineTo(cx + size * 0.15, cy + mark * 1.6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(58,44,30,0.34)';
    ctx.font = `italic ${size * 0.026}px ${SERIF}`;
    ctx.fillText('sin disco en el plato', cx, cy + mark * 2.9);
    ctx.restore();
  }

  // Grano y desgaste de cartón.
  ctx.save();
  ctx.globalAlpha = 0.35;
  const pattern = ctx.createPattern(getGrain(), 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
  drawEdgeWear(ctx, size);

  // Lomo: franja de cartón con el título en vertical.
  const spine = size * 0.032;
  const spineGrad = ctx.createLinearGradient(0, 0, spine, 0);
  spineGrad.addColorStop(0, 'rgba(38,28,18,0.34)');
  spineGrad.addColorStop(0.55, 'rgba(255,250,238,0.16)');
  spineGrad.addColorStop(1, 'rgba(38,28,18,0.08)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(0, 0, spine, size);

  ctx.save();
  ctx.translate(spine * 0.62, size * 0.5);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(250,244,232,0.78)';
  ctx.font = `600 ${size * 0.019}px ${SANS}`;
  const spineText = `${title}  ·  ${artist}`.toUpperCase();
  ctx.fillText(spineText, 0, 0, size * 0.84);
  ctx.restore();

  return surface.canvas;
};

export interface SleeveBackData {
  title: string;
  artist: string;
  album: string;
  duration: number;
  rpm: number;
  lyrics: Lyrics | null;
  activeIndex: number;
  status: 'idle' | 'loading' | 'ready' | 'missing';
}

/**
 * Subrayado a mano: una pasada gruesa y translúcida debajo y otra con temblor
 * encima, como cuando repasas la línea con la pluma dos veces.
 */
const drawHandUnderline = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string,
): void => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const steps = 22;
  const path = (offset: number, amp: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x + width * t;
      const py = y + offset + Math.sin(t * Math.PI * 2.6) * amp + Math.sin(t * Math.PI * 7.3) * amp * 0.28 + t * 0.7;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 3.6;
  path(0.9, 1.5);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.1;
  path(0, 1.1);
  ctx.restore();
};

/** Reverso: liner notes impresas, con el verso actual subrayado a mano. */
export const makeSleeveBack = (
  size: number,
  dpr: number,
  palette: Palette,
  data: SleeveBackData,
): HTMLCanvasElement => {
  const surface = makeSurface(size, size, dpr);
  const { ctx } = surface;
  const pad = size * 0.105;

  drawPaper(ctx, size, hsl(38, 0.24, 0.90));
  ctx.save();
  ctx.globalAlpha = 0.4;
  const pattern = ctx.createPattern(getGrain(), 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();

  // Cabecera impresa.
  ctx.fillStyle = hsl(30, 0.18, 0.38);
  ctx.font = `600 ${size * 0.019}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('LINER NOTES', pad, pad * 0.82);

  ctx.fillStyle = palette.labelInk;
  ctx.font = `600 ${size * 0.044}px ${SERIF}`;
  const titleLines = wrapText(ctx, data.title, size - pad * 2, 2);
  let headY = pad * 1.22;
  for (const line of titleLines) {
    ctx.fillText(line, pad, headY);
    headY += size * 0.05;
  }
  ctx.fillStyle = hsl(30, 0.20, 0.38);
  ctx.font = `500 ${size * 0.021}px ${SANS}`;
  ctx.fillText(data.artist.toUpperCase(), pad, headY + size * 0.012);

  ctx.strokeStyle = 'rgba(60,44,28,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, headY + size * 0.042);
  ctx.lineTo(size - pad, headY + size * 0.042);
  ctx.stroke();

  const bodyTop = headY + size * 0.095;
  const bodyBottom = size - pad * 1.5;
  const lineHeight = size * 0.0375;

  const hasLines = data.lyrics && data.lyrics.lines.length > 0;
  if (hasLines) {
    const lines = data.lyrics!.lines;
    const active = data.activeIndex;
    const visible = Math.max(6, Math.floor((bodyBottom - bodyTop) / lineHeight));
    let start = 0;
    if (active >= 0) {
      start = Math.max(0, active - Math.floor(visible * 0.45));
    } else {
      const ratio = data.duration > 0 ? Math.min(1, Math.max(0, (data.activeIndex + 1) / lines.length)) : 0;
      start = Math.floor(ratio * Math.max(0, lines.length - visible));
    }
    const accentInk = hsl(14, 0.58, 0.36);
    ctx.font = `${size * 0.0285}px ${SERIF}`;
    ctx.textAlign = 'center';
    for (let i = 0; i < visible; i++) {
      const line = lines[start + i];
      if (!line) break;
      const y = bodyTop + i * lineHeight;
      const isActive = start + i === active;
      const distance = Math.abs(start + i - active);
      const fade = isActive ? 1 : active >= 0 ? Math.max(0.4, 0.78 - distance * 0.1) : 0.62;
      ctx.globalAlpha = fade;
      ctx.fillStyle = isActive ? accentInk : palette.labelInk;
      const text = wrapText(ctx, line.text, size - pad * 2.3, 2);
      for (let j = 0; j < text.length; j++) {
        ctx.fillText(text[j], size / 2, y + j * lineHeight * 0.92);
      }
      if (isActive) {
        const width = Math.min(size - pad * 2.2, ctx.measureText(text[text.length - 1] ?? '').width + size * 0.06);
        drawHandUnderline(ctx, (size - width) / 2, y + lineHeight * 0.52, width, accentInk);
        ctx.fillStyle = accentInk;
        ctx.beginPath();
        ctx.arc(pad * 0.72, y - size * 0.008, size * 0.0045, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (data.status === 'loading') {
      ctx.globalAlpha = 0.5;
      ctx.textAlign = 'center';
      ctx.fillStyle = palette.labelInk;
      ctx.font = `italic ${size * 0.026}px ${SERIF}`;
      ctx.fillText('buscando la letra en el archivo…', size / 2, bodyTop + lineHeight * 0.6);
      ctx.globalAlpha = 1;
    }
  } else {
    // Ficha técnica: pieza instrumental o letra que no está en el archivo.
    // Los dos casos no se cuentan igual: un instrumental es una decisión del
    // disco, una letra ausente es una búsqueda que no encontró nada.
    const searching = data.status === 'loading' || data.status === 'idle';
    const instrumental = data.lyrics?.instrumental === true;
    const catalog = `SPIN-${String(hashString(`${data.artist}|${data.title}`) % 9000 + 1000)}`;
    const rows: Array<[string, string]> = [
      ['ÁLBUM', data.album || '—'],
      ['DURACIÓN', formatTime(data.duration)],
      ['VELOCIDAD', `${data.rpm === 45 ? '45' : '33⅓'} RPM`],
      ['FORMATO', 'VINILO · ESTÉREO'],
      ['CATÁLOGO', catalog],
      [
        'NOTA',
        searching
          ? 'Buscando la letra…'
          : instrumental
            ? 'PIEZA INSTRUMENTAL · SIN VOZ'
            : 'LETRA NO REGISTRADA EN EL ARCHIVO',
      ],
    ];
    ctx.textAlign = 'left';
    let y = bodyTop + lineHeight * 0.4;
    for (const [label, value] of rows) {
      ctx.fillStyle = hsl(30, 0.14, 0.48);
      ctx.font = `600 ${size * 0.017}px ${SANS}`;
      ctx.fillText(label, pad, y);
      ctx.fillStyle = palette.labelInk;
      ctx.font = `${size * 0.0245}px ${SERIF}`;
      const wrapped = wrapText(ctx, value, size - pad * 2 - size * 0.16, 2);
      wrapped.forEach((line, i) => ctx.fillText(line, pad, y + size * 0.03 + i * size * 0.03));
      y += size * 0.075 + (wrapped.length - 1) * size * 0.03;
    }

    // Código de catálogo dibujado: remata la ficha y deja de parecer un
    // formulario a medio llenar.
    const barsY = Math.min(y + size * 0.05, bodyBottom - size * 0.03);
    let barsX = pad;
    for (let i = 0; i < 34; i += 1) {
      const width = [1, 1.6, 2.4, 1.2][(hashString(catalog) >> (i % 12)) & 3] ?? 1;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(58,44,30,0.62)' : 'rgba(58,44,30,0.22)';
      ctx.fillRect(barsX, barsY, width, size * 0.032);
      barsX += width + 2.4;
    }
    ctx.fillStyle = hsl(30, 0.14, 0.46);
    ctx.font = `${size * 0.0145}px ${SANS}`;
    ctx.letterSpacing = `${size * 0.0035}px`;
    ctx.fillText(`${catalog} · LADO A · ESTÉREO`, pad, barsY + size * 0.055);
    ctx.letterSpacing = '0px';

    // Sello circular de tinta: dice cuál de los dos casos es.
    ctx.save();
    ctx.translate(size - pad * 1.15, bodyBottom - size * 0.075);
    ctx.rotate(-0.12);
    ctx.strokeStyle = hsl(16, 0.42, 0.48, 0.55);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.075, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.062, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = hsl(16, 0.42, 0.44, 0.75);
    ctx.textAlign = 'center';
    ctx.font = `600 ${size * 0.016}px ${SANS}`;
    ctx.fillText(instrumental ? 'INSTRUMENTAL' : 'SIN LETRA', 0, -size * 0.004);
    ctx.font = `${size * 0.013}px ${SANS}`;
    ctx.fillText(instrumental ? 'SIN VOZ' : 'EN EL ARCHIVO', 0, size * 0.018);
    ctx.restore();
  }

  // Pie de imprenta.
  ctx.textAlign = 'center';
  ctx.fillStyle = hsl(30, 0.12, 0.46);
  ctx.font = `500 ${size * 0.0165}px ${SANS}`;
  ctx.fillText('SPINDISK · HECHO PARA ESCUCHARSE DESPACIO', size / 2, size - pad * 0.62);

  drawEdgeWear(ctx, size);
  return surface.canvas;
};

/** Reloj de escritorio impreso en el cartón, con alpha = progreso del modo. */
export const drawSleeveClock = (
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: Palette,
  alpha: number,
  time: string,
  date: string,
): void => {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // La hora no se imprime encima de la fotografía: se imprime en un fajín de
  // papel crema que cruza la parte baja de la funda, como el obi de una
  // edición especial. Así el retrato respira y la hora se lee desde lejos.
  const bandH = size * 0.226;
  const bandY = size - bandH;
  const pad = size * 0.062;

  // El papel se apoya sobre la carátula: sombra corta hacia arriba.
  const shade = ctx.createLinearGradient(0, bandY - size * 0.052, 0, bandY);
  shade.addColorStop(0, 'rgba(48,34,20,0)');
  shade.addColorStop(0.62, 'rgba(48,34,20,0.10)');
  shade.addColorStop(1, 'rgba(48,34,20,0.26)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, bandY - size * 0.052, size, size * 0.052);

  const paper = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
  paper.addColorStop(0, hsl(40, 0.30, 0.955));
  paper.addColorStop(0.5, hsl(39, 0.26, 0.925));
  paper.addColorStop(1, hsl(37, 0.24, 0.875));
  ctx.fillStyle = paper;
  ctx.fillRect(0, bandY, size, bandH);

  // Grano del papel y los dos cantos impresos.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, bandY, size, bandH);
  ctx.clip();
  ctx.globalAlpha = alpha * 0.5;
  ctx.drawImage(getGrain(), 0, bandY, size, bandH);
  ctx.restore();

  ctx.strokeStyle = 'rgba(70,52,34,0.34)';
  ctx.lineWidth = Math.max(1, size * 0.0022);
  for (const y of [bandY, bandY + bandH]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Hora a la izquierda, en serif viejo.
  const baseline = bandY + bandH * 0.575;
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.labelInk;
  ctx.font = `400 ${size * 0.108}px ${SERIF}`;
  ctx.fillText(time, pad, baseline);

  ctx.fillStyle = hsl(30, 0.18, 0.40);
  ctx.font = `italic ${size * 0.0215}px ${SERIF}`;
  ctx.fillText('el tocadiscos descansa', pad + size * 0.004, bandY + bandH * 0.845);

  // Fecha y sello, a la derecha.
  ctx.textAlign = 'right';
  const right = size - pad;
  ctx.fillStyle = hsl(30, 0.22, 0.34);
  ctx.font = `500 ${size * 0.0245}px ${SANS}`;
  ctx.letterSpacing = `${size * 0.0035}px`;
  ctx.fillText(date.toUpperCase(), right, bandY + bandH * 0.50);

  ctx.fillStyle = hsl(30, 0.14, 0.50);
  ctx.font = `400 ${size * 0.019}px ${SANS}`;
  ctx.letterSpacing = `${size * 0.0045}px`;
  ctx.fillText('SPINDISK · DESCANSO', right, bandY + bandH * 0.845);
  ctx.letterSpacing = '0px';

  ctx.restore();
};

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
import { SANS, SERIF } from '../theme/fonts.js';

let grainTile: HTMLCanvasElement | null = null;
const getGrain = (): HTMLCanvasElement => {
  if (!grainTile) grainTile = makeGrainTile(128, 0.1, 19);
  return grainTile;
};

let measureCtx: CanvasRenderingContext2D | null = null;
export const prewrapLyrics = (lyrics: Lyrics, size: number): void => {
  if (lyrics.wrapped || lyrics.lines.length === 0) return;
  if (!measureCtx) {
    measureCtx = makeSurface(4, 4).ctx;
  }
  const pad = size * 0.105;
  measureCtx.font = `${size * 0.0285}px ${SERIF}`;
  lyrics.wrapped = lyrics.lines.map((l) => {
    const parts = wrapText(measureCtx!, l.text, size - pad * 2.3, 99);
    return parts.length > 0 ? parts : [''];
  });
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
  reuse?: HTMLCanvasElement | null,
): HTMLCanvasElement => {
  const surface = makeSurface(size, size, dpr, reuse);
  const { ctx } = surface;

  drawPaper(ctx, size, palette.paper);
  if (cover) {
    drawCoverFit(ctx, cover, 0, 0, size, size);
    // Impresión mate: velo cálido en source-over para evitar el readback de
    // software del blend mode 'saturation' en Skia/WebView (< 0,5 ms).
    ctx.fillStyle = 'rgba(42,36,28,0.10)';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(244,234,214,0.09)';
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

export const SLEEVE_PHRASES: readonly string[] = [
  'En la tarde cálida, el recuerdo de ti emerge en silencio.',
  'Las palabras no bastan para decir todo lo que siento.',
  'Solo queda abrazarte fuerte cuando nos volvamos a ver.',
  'Bajo la luz del sol, te ves aún más linda.',
  'Flores, sol, lluvia y tú.',
  'Escribo lo que te extraño en papel y tinta.',
  'Con el paso del tiempo, las ganas de verte lo llenan todo.',
  'Te quiero con una fuerza mayor que el sol naciente.',
  'Quiero estar a tu lado por incontables días y noches.',
  'Quiero darte un amor como la brisa de una noche de verano.',
  'Encontramos alegría en la rutina y ternura en la distancia.',
  'La espera cobra vida porque al otro lado estás tú.',
  'Como brisa de primavera, dejaste tu huella en toda mi vida.',
  'Te pienso en la calma, te sueño al dormir y te busco al despertar.',
  'Lo que me das es más vasto que toda la Vía Láctea.',
  'Enamorarme de ti es lo más hermoso que pude imaginar.',
  'Eres la carta de amor más bella que el mundo escribió para mí.',
  'Tienes la magia de acelerar el tiempo cuando estamos juntos.',
  'Por fin comprendí que siempre te estuve esperando a ti.',
  'Ya no debo esperar más; tú eres mi fortuna.',
  'Eres brisa suave, lluvia fina y nube.',
  'Eres un cuadro de todo lo bello y un poema de cada paisaje.',
  'Eres el sueño más anhelado de mi corazón.',
  'Tu amor hizo florecer un corazón que antes era hojas secas.',
  'Eres la carta de amor que nunca terminaré de escribir.',
  'Eres las estrellas que jamás terminaré de contar.',
  'Eres el alma más brillante e incomparable de este mundo.',
  'En el aire húmedo, se respira todo lo que te extraño.',
  'Al caer la tarde, siempre queda la calidez de nuestras manos.',
  'Desde que te amo, el tiempo y el mundo tienen un brillo único.',
  'Qué suerte tenerte; qué fortuna tan grande que seas tú.',
  'Te sigo amando como aquel primer día en que me enamoré de ti.',
  'Con una brisa fresca de tarde y lluvia suave, cae la noche despacio.',
  'Si me recuerdas, no me importa que el resto del mundo me olvide.',
  'Mientras suene la música, sigue bailando.',
  'Escucha la canción del viento.',
  'Siempre hay una canción que nos devuelve al instante en que nos amamos.',
  'Los recuerdos te calientan por dentro, igual que una vieja melodía.',
  'La luna es hermosa esta noche.',
  'En algún lugar, una aguja cae sobre el vinilo y el tiempo se detiene contigo.',
];

export interface SleeveBackData {
  title: string;
  artist: string;
  album: string;
  duration: number;
  rpm: number;
  lyrics: Lyrics | null;
  activeIndex: number;
  status: 'idle' | 'loading' | 'ready' | 'missing';
  phraseIndex?: number;
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
  reuse?: HTMLCanvasElement | null,
): HTMLCanvasElement => {
  const surface = makeSurface(size, size, dpr, reuse);
  const { ctx } = surface;
  const pad = size * 0.105;

  drawPaper(ctx, size, hsl(38, 0.24, 0.90), 1.4);

  // Cabecera impresa.
  ctx.fillStyle = hsl(30, 0.18, 0.38);
  ctx.font = `600 ${size * 0.0195}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Uva Pasita Está Escuchando...', pad, pad * 0.82);

  ctx.fillStyle = palette.labelInk;
  ctx.font = `600 ${size * 0.044}px ${SERIF}`;
  const titleLines = wrapText(ctx, data.title, size - pad * 2, 2);
  let titleY = pad * 1.22;
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], pad, titleY);
    if (i < titleLines.length - 1) {
      titleY += size * 0.048;
    }
  }

  // Artista: ajustado inmediatamente bajo el título, sin hueco excesivo.
  const artistY = titleY + size * 0.034;
  ctx.fillStyle = hsl(30, 0.20, 0.38);
  ctx.font = `500 ${size * 0.021}px ${SANS}`;
  ctx.fillText(data.artist.toUpperCase(), pad, artistY);

  // Línea divisoria.
  const ruleY = artistY + size * 0.028;
  ctx.strokeStyle = 'rgba(60,44,28,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, ruleY);
  ctx.lineTo(size - pad, ruleY);
  ctx.stroke();

  const bodyTop = ruleY + size * 0.038;
  const bodyBottom = size - pad * 1.5;
  const lineHeight = size * 0.0375;

  const hasLines = data.lyrics && data.lyrics.lines.length > 0;
  if (hasLines) {
    const lyricsObj = data.lyrics!;
    const lines = lyricsObj.lines;
    const active = data.activeIndex;
    const accentInk = hsl(14, 0.58, 0.36);
    ctx.font = `${size * 0.0285}px ${SERIF}`;
    ctx.textAlign = 'center';
    // Cada verso se parte en todos los renglones que necesite (sin recorte) y
    // ocupa su altura real, de modo que nunca pisa al siguiente.
    const rowH = lineHeight * 0.92;
    const gap = lineHeight * 0.22;
    if (!lyricsObj.wrapped) {
      lyricsObj.wrapped = lines.map((l) => {
        const parts = wrapText(ctx, l.text, size - pad * 2.3, 99);
        return parts.length > 0 ? parts : [''];
      });
    }
    const wrapped = lyricsObj.wrapped;
    const heightOf = (i: number): number => Math.max(1, wrapped[i].length) * rowH + gap;
    const avail = bodyBottom - bodyTop;
    const centerY = bodyTop + avail / 2;
    // La estrofa actual (o la primera si aún no arranca) se ubica en la mitad
    // del lienzo disponible, permitiendo que la oración se lea completa y respire.
    const target = active >= 0 ? active : 0;
    let offsetBefore = 0;
    for (let i = 0; i < target; i++) {
      offsetBefore += heightOf(i);
    }
    const startY = centerY - heightOf(target) / 2 - offsetBefore;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.beginPath();
    ctx.rect(0, bodyTop - size * 0.01, size, avail + size * 0.02);
    ctx.clip();

    let curY = startY;
    for (let i = 0; i < lines.length; i++) {
      const text = wrapped[i];
      const h = heightOf(i);
      if (curY + h >= bodyTop - size * 0.02 && curY <= bodyBottom + size * 0.02) {
        const isActive = i === active;
        const distance = Math.abs(i - (active >= 0 ? active : 0));
        const fade = isActive ? 1 : active >= 0 ? Math.max(0.35, 0.78 - distance * 0.12) : 0.62;
        ctx.globalAlpha = fade;
        ctx.fillStyle = isActive ? accentInk : palette.labelInk;
        for (let j = 0; j < text.length; j++) {
          if (text[j]) ctx.fillText(text[j], size / 2, curY + j * rowH);
        }
        if (isActive && text.length > 0 && text[0]) {
          const lastY = curY + (text.length - 1) * rowH;
          const width = Math.min(size - pad * 2.2, ctx.measureText(text[text.length - 1] ?? '').width + size * 0.06);
          drawHandUnderline(ctx, (size - width) / 2, lastY + rowH * 0.95, width, accentInk);
          ctx.fillStyle = accentInk;
          ctx.beginPath();
          ctx.arc(pad * 0.72, curY + rowH * 0.45, size * 0.0045, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      curY += h;
      if (curY > bodyBottom + size * 0.05) break;
    }
    ctx.restore();
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

  // Pie de imprenta: frase poética aleatoria.
  const phrase = (data.phraseIndex !== undefined && SLEEVE_PHRASES[Math.abs(data.phraseIndex) % SLEEVE_PHRASES.length])
    ? SLEEVE_PHRASES[Math.abs(data.phraseIndex) % SLEEVE_PHRASES.length]
    : SLEEVE_PHRASES[0];

  ctx.textAlign = 'center';
  ctx.fillStyle = hsl(30, 0.14, 0.44);
  const maxPhraseWidth = size - pad * 1.6;
  let phraseFontSize = size * 0.0155;
  ctx.font = `italic 500 ${phraseFontSize}px ${SERIF}`;
  let measured = ctx.measureText(phrase).width;
  if (measured > maxPhraseWidth) {
    phraseFontSize = Math.max(8.5, phraseFontSize * (maxPhraseWidth / measured));
    ctx.font = `italic 500 ${phraseFontSize}px ${SERIF}`;
  }
  ctx.fillText(phrase, size / 2, size - pad * 0.62);

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
  phraseIndex = 0,
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

  // Grano del papel y los dos cantos impresos. Sin `clip`: el `drawImage` ya
  // cae exactamente sobre la banda, y un recorte sobre el lienzo grande obliga
  // a Skia a componer una capa por fotograma (medido: 47 ms).
  ctx.globalAlpha = alpha * 0.5;
  ctx.drawImage(getGrain(), 0, bandY, size, bandH);
  ctx.globalAlpha = alpha;

  ctx.strokeStyle = 'rgba(70,52,34,0.34)';
  ctx.lineWidth = Math.max(1, size * 0.0022);
  for (const y of [bandY, bandY + bandH]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Hora a la izquierda, en serif viejo.
  const baseline = bandY + bandH * 0.55;
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.labelInk;
  ctx.font = `400 ${size * 0.104}px ${SERIF}`;
  ctx.fillText(time, pad, baseline);

  // Fecha a la derecha.
  ctx.textAlign = 'right';
  const right = size - pad;
  ctx.fillStyle = hsl(30, 0.22, 0.34);
  ctx.font = `500 ${size * 0.0235}px ${SANS}`;
  ctx.letterSpacing = `${size * 0.003}px`;
  ctx.fillText(date.toUpperCase(), right, bandY + bandH * 0.48);
  ctx.letterSpacing = '0px';

  // Frase poética aleatoria en la franja inferior del fajín.
  const phrase = SLEEVE_PHRASES[Math.abs(phraseIndex) % SLEEVE_PHRASES.length] ?? SLEEVE_PHRASES[0];
  const maxPhraseW = size - pad * 2;
  let phraseFont = size * 0.0205;
  ctx.font = `italic 500 ${phraseFont}px ${SERIF}`;
  const measured = ctx.measureText(phrase).width;
  if (measured > maxPhraseW) {
    phraseFont = Math.max(9.5, phraseFont * (maxPhraseW / measured));
    ctx.font = `italic 500 ${phraseFont}px ${SERIF}`;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = hsl(30, 0.18, 0.38);
  ctx.fillText(phrase, size / 2, bandY + bandH * 0.845, maxPhraseW);

  ctx.restore();
};

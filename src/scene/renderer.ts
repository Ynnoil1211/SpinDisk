/**
 * Escena completa: mesa, disco, funda y brazo.
 *
 * Orden de dibujo = orden físico: la mesa, el vinilo, la funda (que tapa el
 * vinilo cuando entra) y finalmente el brazo, que flota por encima.
 */

import { LAYOUT, DESIGN, REST_ANGLE, needlePoint } from './layout.js';
import { drawDisc, drawDiscShadow, clearTextureCache } from './disc.js';
import {
  drawSleeveClock,
  makeSleeveBack,
  makeSleeveFront,
  type SleeveBackData,
} from './sleeve.js';
import { makeGrainTile, makeShadowSprite, makeSurface, roundRectPath } from '../render/canvas.js';
import type { Turntable } from './turntable.js';
import type { Palette } from '../theme/palette.js';
import { hsl } from '../theme/palette.js';
import { formatClock } from '../util/math.js';
import { SANS, SERIF } from '../theme/fonts.js';

/**
 * Geometría del papelito con la hora. Se apoya arriba a la izquierda, en el
 * charco de luz, ligeramente torcido para que no parezca un widget.
 */
const CLOCK_CARD = { x: 172, y: 104, w: 208, h: 94, angle: -0.055 };
/** Margen del sprite para que quepa la sombra difusa. */
const CLOCK_PAD = 26;

export class Scene {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private turntable: Turntable;

  private dpr = 1;
  private width = 0;
  private height = 0;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey = '';
  private grain: HTMLCanvasElement;

  private front: HTMLCanvasElement | null = null;
  private frontKey = '';
  private back: HTMLCanvasElement | null = null;
  private backKey = '';
  private sleeveShadow: HTMLCanvasElement | null = null;
  private sleeveShadowKey = '';
  private clockCard: HTMLCanvasElement | null = null;
  private clockCardKey = '';
  private clockBand: HTMLCanvasElement | null = null;
  private clockBandKey = '';

  constructor(canvas: HTMLCanvasElement, turntable: Turntable) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
    this.turntable = turntable;
    this.grain = makeGrainTile(160, 0.055, 41);
    turntable.onTrackVisual = (reason) => {
      if (reason === 'track') {
        this.frontKey = '';
        this.backKey = '';
        clearTextureCache();
      }
    };
  }

  resize(): void {
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.scale = Math.min(width / DESIGN.width, height / DESIGN.height);
    this.ox = (width - DESIGN.width * this.scale) / 2;
    this.oy = (height - DESIGN.height * this.scale) / 2;
    this.backdrop = null;
    this.frontKey = '';
    this.backKey = '';
  }

  /** Convierte coordenadas de pantalla al espacio de diseño. */
  toDesign(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - this.ox) / this.scale,
      y: (clientY - this.oy) / this.scale,
    };
  }

  render(now: number): void {
    const tt = this.turntable;
    const ctx = this.ctx;
    const palette = tt.palette;

    this.ensureBackdrop(palette);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.backdrop as HTMLCanvasElement, 0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    this.drawDiscLayer(palette);
    this.drawSleeve(palette);
    this.drawArm();
    this.drawDeskClock(palette);
    this.drawAmbience(now, palette);
    if (tt.clock > 0.01) this.drawDim(palette, tt.clock);

    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------------ fondo

  private ensureBackdrop(palette: Palette): void {
    const key = `${this.width}x${this.height}|${palette.deskLight}|${palette.deskDark}`;
    if (this.backdrop && key === this.backdropKey) return;

    const surface = document.createElement('canvas');
    surface.width = Math.round(this.width * this.dpr);
    surface.height = Math.round(this.height * this.dpr);
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    ctx.scale(this.dpr, this.dpr);
    const w = this.width;
    const h = this.height;

    const base = ctx.createLinearGradient(0, 0, w * 0.35, h);
    base.addColorStop(0, palette.deskLight);
    base.addColorStop(0.55, palette.deskLight);
    base.addColorStop(1, palette.deskDark);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Charco de luz cálida desde arriba a la izquierda.
    const light = ctx.createRadialGradient(w * 0.22, h * -0.1, h * 0.05, w * 0.22, h * -0.1, h * 1.15);
    light.addColorStop(0, 'rgba(255, 250, 232, 0.55)');
    light.addColorStop(0.45, 'rgba(255, 246, 224, 0.16)');
    light.addColorStop(1, 'rgba(255, 246, 224, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);

    // Viñeta.
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.34, w * 0.5, h * 0.5, h * 1.05);
    vignette.addColorStop(0, 'rgba(40,28,18,0)');
    vignette.addColorStop(1, 'rgba(40,28,18,0.20)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    const pattern = ctx.createPattern(this.grain, 'repeat');
    if (pattern) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    this.backdrop = surface;
    this.backdropKey = key;
  }

  // ------------------------------------------------------------------ disco

  private drawDiscLayer(palette: Palette): void {
    const tt = this.turntable;
    const cx = tt.discX;
    const cy = LAYOUT.disc.cy;
    const r = LAYOUT.disc.r;

    drawDiscShadow(this.ctx, cx, cy, r, palette);

    if (tt.discOut < 0.005 && !tt.track) return;

    drawDisc(this.ctx, {
      cx,
      cy,
      r,
      spin: tt.spinAngle,
      texture: tt.texture,
      seed: tt.textureSeed,
      palette,
      title: tt.track?.title ?? 'Sin título',
      artist: tt.track?.artist ?? '—',
      album: tt.track?.album ?? '',
      rpm: tt.rpm,
      side: 'LADO A',
      opacity: 1,
    });
  }

  // ------------------------------------------------------------------ funda

  private drawSleeve(palette: Palette): void {
    const tt = this.turntable;
    const ctx = this.ctx;
    const size = LAYOUT.sleeve.size;
    const flip = tt.flip;
    const sx = Math.cos(Math.PI * flip);

    // Sprite frontal.
    const frontKey = `${tt.cover?.currentSrc ?? 'none'}|${palette.paper}|${tt.track?.title ?? ''}`;
    if (frontKey !== this.frontKey || !this.front) {
      this.front = makeSleeveFront(size, 2, palette, tt.cover, tt.track?.title ?? '', tt.track?.artist ?? '');
      this.frontKey = frontKey;
    }

    // Sombra proyectada sobre la mesa (y sobre el disco).
    const shadowKey = palette.shadow;
    if (!this.sleeveShadow || shadowKey !== this.sleeveShadowKey) {
      this.sleeveShadow = makeShadowSprite(size, size, 4, 24, 'rgba(44,32,20,0.42)', 6);
      this.sleeveShadowKey = shadowKey;
    }

    ctx.save();
    ctx.translate(LAYOUT.sleeve.cx, LAYOUT.sleeve.cy);
    ctx.rotate(LAYOUT.sleeve.rotation);

    // Cuando el cartón pasa de canto se despega de la mesa: la sombra se abre,
    // se corre hacia la luz y pierde densidad.
    const lift = Math.sin(Math.PI * flip);
    if (this.sleeveShadow) {
      const sw = this.sleeveShadow.width;
      const sh = this.sleeveShadow.height;
      const pad = (sw - size) / 2;
      const grow = 1 + lift * 0.09;
      ctx.save();
      ctx.globalAlpha = 1 - lift * 0.34;
      ctx.drawImage(
        this.sleeveShadow,
        -size / 2 - pad + 10 + lift * 12,
        -size / 2 - pad + 16 + lift * 10,
        sw * grow,
        sh * grow,
      );
      ctx.restore();
    }

    ctx.save();
    ctx.translate(0, -lift * 4);
    ctx.scale(Math.abs(sx) || 0.0008, 1);
    const facingBack = sx < 0;

    if (facingBack) {
      const active = tt.activeLine();
      const data: SleeveBackData = {
        title: tt.track?.title ?? 'Sin título',
        artist: tt.track?.artist ?? '—',
        album: tt.track?.album ?? '',
        duration: tt.duration,
        rpm: tt.rpm,
        lyrics: tt.lyrics,
        activeIndex: active,
        status: tt.lyricsStatus,
      };
      const backKey = `${data.title}|${data.artist}|${active}|${tt.lyricsStatus}|${tt.rpm}|${data.album}`;
      if (backKey !== this.backKey || !this.back) {
        this.back = makeSleeveBack(size, 2, palette, data);
        this.backKey = backKey;
      }
      ctx.drawImage(this.back, -size / 2, -size / 2, size, size);
    } else {
      ctx.drawImage(this.front, -size / 2, -size / 2, size, size);
    }

    // Oscurecimiento al pasar de canto.
    const edge = 1 - Math.abs(sx);
    if (edge > 0.02) {
      ctx.fillStyle = `rgba(28,20,12,${0.46 * Math.pow(edge, 1.35)})`;
      roundRectPath(ctx, -size / 2, -size / 2, size, size, 3);
      ctx.fill();
    }

    // Reflejo que barre la cara mientras gira: el cartón mate no lo daría,
    // pero es lo que vende el movimiento en una pantalla.
    if (lift > 0.05) {
      ctx.save();
      roundRectPath(ctx, -size / 2, -size / 2, size, size, 3);
      ctx.clip();
      const sweep = -size + flip * size * 2;
      const sheen = ctx.createLinearGradient(sweep - size * 0.3, -size / 2, sweep + size * 0.3, size / 2);
      sheen.addColorStop(0, 'rgba(255,248,232,0)');
      sheen.addColorStop(0.5, `rgba(255,248,232,${0.16 * lift})`);
      sheen.addColorStop(1, 'rgba(255,248,232,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();

    // La hora se imprime sobre la cara que esté mirando: si la funda está
    // del revés (letra), el fajín también aparece, sin espejo y con el mismo
    // aplastamiento del giro. Un tocadiscos dormido no debe quedarse en negro.
    if (tt.clock > 0.001) this.drawClockBand(size, palette, lift, sx);

    // Canto del cartón: cuando la funda está casi de perfil sólo se ve el
    // espesor del material, no una línea.
    if (lift > 0.84) {
      const thickness = 7;
      const a = (lift - 0.84) / 0.16;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#e7dcc4';
      ctx.fillRect(-thickness / 2, -size / 2, thickness, size);
      ctx.fillStyle = 'rgba(96,74,48,0.55)';
      ctx.fillRect(-thickness / 2, -size / 2, 1.4, size);
      ctx.fillStyle = 'rgba(255,250,238,0.7)';
      ctx.fillRect(thickness / 2 - 1.6, -size / 2, 1.6, size);
      ctx.restore();
    }

    ctx.restore();
  }

  // ------------------------------------------------------------------- brazo

  private drawArm(): void {
    const tt = this.turntable;
    const ctx = this.ctx;
    const px = LAYOUT.arm.px;
    const py = LAYOUT.arm.py;
    const angle = tt.armAngle;
    const lift = tt.armLift;
    const tip = needlePoint(angle, LAYOUT.arm.length - 22);
    const needle = needlePoint(angle);

    // Soporte de descanso: poste de aluminio con pinza de goma, justo donde
    // aparca la aguja. Sin él el brazo parece flotar sobre la mesa. Se dibuja
    // en el espacio de la pantalla (sin rotar): el poste baja, no sigue al tubo.
    const restTip = needlePoint(REST_ANGLE, LAYOUT.arm.length - 14);
    ctx.save();
    ctx.translate(restTip.x, restTip.y);
    ctx.fillStyle = 'rgba(40,32,24,0.18)';
    ctx.beginPath();
    ctx.ellipse(10, 38, 24, 8, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dad2c2';
    ctx.beginPath();
    ctx.ellipse(0, 34, 15, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const post = ctx.createLinearGradient(-4, 0, 5, 0);
    post.addColorStop(0, '#efe9dc');
    post.addColorStop(0.5, '#b6ada0');
    post.addColorStop(1, '#6d6558');
    ctx.fillStyle = post;
    roundRectPath(ctx, -4, 6, 8, 29, 3);
    ctx.fill();
    // Pinza: dos dientes de goma negra que abrazan el tubo.
    ctx.fillStyle = '#211d19';
    roundRectPath(ctx, -9, -7, 18, 7, 2.5);
    ctx.fill();
    roundRectPath(ctx, -9, -21, 5, 15, 2);
    ctx.fill();
    roundRectPath(ctx, 4, -21, 5, 15, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,250,240,0.16)';
    ctx.fillRect(-6.5, -6.4, 13, 1.2);
    ctx.restore();

    // Sombra del brazo sobre el disco.
    if (lift < 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tt.discX, LAYOUT.disc.cy, LAYOUT.disc.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.30 * (1 - lift * 2);
      ctx.strokeStyle = '#2a2016';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + 9, py + 12);
      ctx.quadraticCurveTo(
        (px + tip.x) / 2 + 9 - Math.sin(angle) * 6,
        (py + tip.y) / 2 + 12 + Math.cos(angle) * 6,
        tip.x + 9,
        tip.y + 12,
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(0, -lift * 7);

    // Contrapeso: cilindro negro roscado en la cola del brazo.
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle + Math.PI);
    const cw = LAYOUT.arm.counterweight;
    const body = ctx.createLinearGradient(0, -11, 0, 11);
    body.addColorStop(0, '#544c43');
    body.addColorStop(0.28, '#2b2620');
    body.addColorStop(0.6, '#131110');
    body.addColorStop(0.86, '#241f1a');
    body.addColorStop(1, '#0b0a09');
    ctx.fillStyle = body;
    roundRectPath(ctx, 48, -11, cw - 48, 22, 4);
    ctx.fill();
    // Aro de agarre en el extremo.
    ctx.fillStyle = '#3a342c';
    roundRectPath(ctx, cw - 9, -11.5, 9, 23, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,250,240,0.22)';
    ctx.fillRect(52, -9.5, cw - 62, 2.2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(52, 8, cw - 62, 1.6);
    // Eje roscado que une contrapeso y base.
    ctx.fillStyle = 'rgba(20,17,14,0.9)';
    roundRectPath(ctx, 30, -3, 22, 6, 3);
    ctx.fill();
    ctx.restore();

    // Tubo con brillo metálico.
    const midX = (px + tip.x) / 2 - Math.sin(angle) * 7;
    const midY = (py + tip.y) / 2 + Math.cos(angle) * 7;
    const nx = Math.cos(angle + Math.PI / 2);
    const ny = Math.sin(angle + Math.PI / 2);

    const tube = ctx.createLinearGradient(px + nx * 6, py + ny * 6, px - nx * 6, py - ny * 6);
    tube.addColorStop(0, '#6c665c');
    tube.addColorStop(0.22, '#f6f1e6');
    tube.addColorStop(0.48, '#b9b2a4');
    tube.addColorStop(0.72, '#efe8db');
    tube.addColorStop(1, '#57514a');

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(28,22,16,0.45)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(midX, midY, tip.x, tip.y);
    ctx.stroke();

    ctx.strokeStyle = tube;
    ctx.lineWidth = 5.6;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(midX, midY, tip.x, tip.y);
    ctx.stroke();

    // Cabezal negro mate.
    const headAngle = angle + 0.10;
    ctx.save();
    ctx.translate(tip.x + Math.cos(headAngle) * 12, tip.y + Math.sin(headAngle) * 12);
    ctx.rotate(headAngle);
    const headGrad = ctx.createLinearGradient(0, -9, 0, 9);
    headGrad.addColorStop(0, '#3a3733');
    headGrad.addColorStop(0.45, '#151412');
    headGrad.addColorStop(1, '#0a0908');
    ctx.fillStyle = headGrad;
    roundRectPath(ctx, -16, -8.5, 38, 17, 4.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,238,0.16)';
    ctx.lineWidth = 0.8;
    roundRectPath(ctx, -16, -8.5, 38, 17, 4.5);
    ctx.stroke();
    // Pestaña para levantar la aguja.
    ctx.fillStyle = '#2a2724';
    roundRectPath(ctx, 12, -12, 9, 5, 2);
    ctx.fill();
    // Cápsula y aguja.
    ctx.fillStyle = '#1b1917';
    roundRectPath(ctx, 6, -6, 14, 12, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,232,214,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(20, 4);
    ctx.lineTo(24, 7);
    ctx.stroke();
    ctx.restore();

    // Base: plinto de aluminio cepillado con buje negro y tornillo.
    const baseR = LAYOUT.arm.baseR;
    ctx.beginPath();
    ctx.arc(px, py + 7, baseR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,22,14,0.26)';
    ctx.fill();

    const baseGrad = ctx.createLinearGradient(px - baseR, py - baseR, px + baseR, py + baseR);
    baseGrad.addColorStop(0, '#f0ebdf');
    baseGrad.addColorStop(0.3, '#b3ab9c');
    baseGrad.addColorStop(0.62, '#6f675b');
    baseGrad.addColorStop(1, '#332e27');
    ctx.beginPath();
    ctx.arc(px, py, baseR, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(24,19,14,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Buje central negro donde gira el brazo.
    ctx.beginPath();
    ctx.arc(px, py, baseR * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#211d19';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - baseR * 0.16, py - baseR * 0.2, baseR * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(240,232,214,0.5)';
    ctx.fill();
    // Tornillo de fijación.
    ctx.beginPath();
    ctx.arc(px + baseR * 0.6, py + baseR * 0.42, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28,23,18,0.55)';
    ctx.fill();
    ctx.restore();

    // Sombra de la aguja sobre el surco.
    if (lift < 0.25) {
      ctx.save();
      ctx.globalAlpha = 1 - lift * 4;
      ctx.beginPath();
      ctx.arc(tt.discX, LAYOUT.disc.cy, LAYOUT.disc.r, 0, Math.PI * 2);
      ctx.clip();
      const g = ctx.createRadialGradient(needle.x + 4, needle.y + 6, 1, needle.x + 4, needle.y + 6, 11);
      g.addColorStop(0, 'rgba(20,14,8,0.45)');
      g.addColorStop(1, 'rgba(20,14,8,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(needle.x + 4, needle.y + 6, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ------------------------------------------------- reloj de reposo (fajín)

  /**
   * El fajín con la hora se imprime **una vez por minuto** y se guarda como
   * sprite. Dibujarlo entero en cada fotograma costaba 47 ms de CPU (medido a
   * 2560×1600): justo el estado en el que la especificación pide no trabajar
   * ni procesador ni tarjeta gráfica. Ahora dormido cuesta lo mismo que un
   * `drawImage`.
   */
  private drawClockBand(size: number, palette: Palette, lift: number, sx: number): void {
    const tt = this.turntable;
    const { time, date } = formatClock(new Date(Date.now()));
    const top = size - size * 0.226 - size * 0.052;
    const height = size - top;
    const key = `${time}|${date}|${palette.paper}|${palette.labelInk}|${size}`;

    if (key !== this.clockBandKey || !this.clockBand) {
      const band = makeSurface(size, height, 2);
      band.ctx.translate(0, -top);
      drawSleeveClock(band.ctx, size, palette, 1, time, date);
      this.clockBand = band.canvas;
      this.clockBandKey = key;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(0, -lift * 4);
    ctx.scale(Math.abs(sx) || 0.0008, 1);
    ctx.translate(-size / 2, -size / 2);
    ctx.globalAlpha = tt.clock;
    ctx.drawImage(this.clockBand, 0, top, size, height);
    ctx.restore();
  }

  // ---------------------------------------------------------- reloj de día

  /**
   * Tarjeta con la hora para cuando el tocadiscos se usa *mientras* suena.
   *
   * El reloj de reposo se imprime en el fajín de la funda y llega solo: a los
   * sesenta segundos en pausa. Éste es el otro reloj, el de sobremesa: un
   * papelito apoyado en la mesa, opcional, que no tapa la carátula ni apaga la
   * escena. Vive arriba a la izquierda, en la luz, donde el ojo cae primero.
   */
  private drawDeskClock(palette: Palette): void {
    const alpha = this.turntable.clockTag;
    if (alpha < 0.02) return;

    const { time, date } = formatClock(new Date(Date.now()));
    const key = `${time}|${date}|${palette.paper}|${palette.ink}`;
    if (!this.clockCard || key !== this.clockCardKey) {
      this.clockCard = this.makeClockCard(time, date);
      this.clockCardKey = key;
    }
    if (!this.clockCard) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(CLOCK_CARD.x, CLOCK_CARD.y);
    ctx.rotate(CLOCK_CARD.angle);
    ctx.drawImage(
      this.clockCard,
      -CLOCK_CARD.w / 2 - CLOCK_PAD,
      -CLOCK_CARD.h / 2 - CLOCK_PAD,
    );
    ctx.restore();
  }

  private makeClockCard(time: string, date: string): HTMLCanvasElement | null {
    const w = CLOCK_CARD.w;
    const h = CLOCK_CARD.h;
    const pad = CLOCK_PAD;
    const { canvas: surface, ctx } = makeSurface(w + pad * 2, h + pad * 2, this.dpr);

    ctx.drawImage(makeShadowSprite(w, h, 4, 12, 'rgba(58,40,24,0.26)', 1.5), pad + 2, pad + 5);

    ctx.save();
    roundRectPath(ctx, pad, pad, w, h, 3.5);
    const paper = ctx.createLinearGradient(pad, pad, pad + w * 0.45, pad + h);
    paper.addColorStop(0, hsl(40, 0.26, 0.935));
    paper.addColorStop(0.62, hsl(39, 0.24, 0.905));
    paper.addColorStop(1, hsl(37, 0.22, 0.858));
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.clip();
    const grain = ctx.createPattern(this.grain, 'repeat');
    if (grain) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = grain;
      ctx.fillRect(pad, pad, w, h);
      ctx.globalAlpha = 1;
    }

    const ink = 'rgba(52,38,24,0.94)';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    ctx.fillStyle = ink;
    ctx.font = `500 ${Math.round(h * 0.4)}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '-0.01em';
    ctx.fillText(time, pad + 15, pad + h * 0.55);

    const ruleY = pad + h * 0.66;
    ctx.strokeStyle = 'rgba(70,52,34,0.26)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad + 15, ruleY);
    ctx.lineTo(pad + w - 15, ruleY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(58,44,30,0.72)';
    ctx.font = `500 ${Math.round(h * 0.088)}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.12em';
    ctx.fillText(date.toUpperCase(), pad + 15, pad + h * 0.86);
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, pad + 0.5, pad + 0.5, w - 1, h - 1, 3.5);
    ctx.strokeStyle = 'rgba(70,52,34,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    return surface;
  }

  // ---------------------------------------------------------------- ambiente

  private drawAmbience(now: number, palette: Palette): void {
    const tt = this.turntable;
    if (tt.track) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = palette.ink;
    ctx.textAlign = 'center';
    ctx.font = `500 17px ${SANS}`;
    ctx.fillText('Pon algo a sonar en Spotify y el disco aparecerá aquí', 880, 720);
    ctx.font = `400 13px ${SANS}`;
    ctx.globalAlpha = 0.28;
    ctx.fillText('sin prisa · el tocadiscos escucha lo que ya suena', 880, 746);
    ctx.restore();
    void now;
  }

  private drawDim(palette: Palette, amount: number): void {
    const ctx = this.ctx;
    const { width, height } = DESIGN;
    ctx.save();
    // Reposo: la escena baja de brillo como una lámpara al mínimo. El velo es
    // cálido (no gris) para que la mesa siga siendo de tierra y no de oficina.
    ctx.globalAlpha = amount * 0.9;
    ctx.fillStyle = palette.dark ? 'rgba(34,24,14,0.40)' : 'rgba(58,44,30,0.34)';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Un hilo de luz cálida desde arriba a la izquierda mantiene la sensación
    // de lámpara encendida en vez de pantalla apagada.
    ctx.save();
    ctx.globalAlpha = amount * 0.10;
    const glow = ctx.createRadialGradient(width * 0.3, height * 0.1, 0, width * 0.3, height * 0.1, width * 0.7);
    glow.addColorStop(0, 'rgba(255,238,206,1)');
    glow.addColorStop(1, 'rgba(255,238,206,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

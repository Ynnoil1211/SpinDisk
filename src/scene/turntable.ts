/**
 * Máquina del tocadiscos: física, gestos y estados de reposo.
 *
 * No dibuja nada. Mantiene el estado que el render lee cada frame y traduce
 * los gestos en comandos hacia el puente activo (Sandbox o Android).
 */

import type { PlayerBridge, TrackSnapshot, Preferences, DiscTexture } from '../core/types.js';
import { Foley } from '../audio/foley.js';
import type { Lyrics } from '../bridge/lyrics.js';
import { activeLineIndex, fetchLyrics } from '../bridge/lyrics.js';
import { paletteFromImage, defaultPalette, type Palette } from '../theme/palette.js';
import { approach, clamp, easeOutCubic, hashString } from '../util/math.js';
import {
  ARM_ANGLE_AT_EDGE,
  ARM_ANGLE_AT_LABEL,
  LAYOUT,
  REST_ANGLE,
  armAngleForProgress,
  progressForArmAngle,
} from './layout.js';

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'missing';

const REVEAL_DELAY = 450;
const CLOCK_AFTER = 60_000;
const PAUSE_PARK = 900;
/** Duración del giro de la funda; el canto pasa por el medio del recorrido. */
const FLIP_MS = 560;

/**
 * El giro visible va al 36 % de la velocidad física: una vuelta cada 5 s.
 *
 * Un disco de 258 px de radio a 33⅓ RPM real completa una vuelta cada 1,8 s:
 * sobre un plato grande y con vetas claras se percibe como un remolino rápido
 * y cansa la vista. A 5 s por vuelta sigue leyéndose como un plato analógico,
 * acompaña el sonido y deja el mármol quieto a la mirada. La música no cambia
 * de velocidad: sólo el dibujo.
 */
const SPIN_DISPLAY = 1.8 / 5; // 1,8 s por vuelta a 33⅓ RPM, mostrados en 5 s

/**
 * Un toque corto sobre el vinilo es "pausa"; mantener el dedo es "freno".
 *
 * Con el dedo apoyado el plato se detiene y la música se calla; al levantar,
 * lo natural es que vuelva a sonar. Pero un toque seco se siente como un
 * interruptor: el disco se queda parado y la música en pausa hasta que vuelvas
 * a tocarlo. De ahí el umbral: por debajo, toque; por encima, mano apoyada.
 */
const TAP_MS = 300;

export class Turntable {
  readonly foley = new Foley();

  track: TrackSnapshot | null = null;
  palette: Palette = defaultPalette();
  cover: HTMLImageElement | null = null;
  coverReady = false;
  lyrics: Lyrics | null = null;
  lyricsStatus: LyricsStatus = 'idle';
  textureSeed = 1;

  progress = 0;
  duration = 0;
  playing = false;
  canSeek = false;

  spin = 0;
  spinAngle = 0;
  discOut = 0;
  discX: number = LAYOUT.disc.hiddenCx;
  armAngle = REST_ANGLE;
  armLift = 1;

  flip = 0;
  flipTarget = 0;
  clock = 0;
  /** 0..1 presencia del reloj de sobremesa (papelito con la hora, opcional). */
  clockTag = 0;
  braking = 0;
  dragArm = false;

  private flipFrom = 0;
  private flipAt = -1e9;
  private clockForced = false;

  /** Se dispara ante cualquier cambio relevante para la UI. */
  onChange: (() => void) | null = null;
  /** Se dispara cuando hay que liberar la caché de texturas/paleta. */
  onTrackVisual: ((reason: 'cover' | 'track') => void) | null = null;

  private bridge: PlayerBridge;
  private prefs: Preferences;
  private lastSnapshotAt = 0;
  private lastTrackKey = '';
  private revealAt = 0;
  private pausedAt = performance.now();
  private scrubbing = false;
  private scrubAngle = 0;
  private scrubStart = 0;
  private discDownAt = 0;
  private discWasPlaying = false;
  private scrubMoved = false;
  private armDragAngle = 0;
  private armSnapBack = 0;
  private lyricsToken = 0;
  private imageToken = 0;
  private unsubscribe: (() => void) | null = null;
  private needleWasDown = false;

  constructor(bridge: PlayerBridge, prefs: Preferences) {
    this.bridge = bridge;
    this.prefs = prefs;
    this.foley.setVolume(prefs.foley);
    this.pausedAt = performance.now();
  }

  setPreferences(prefs: Preferences): void {
    this.prefs = prefs;
    this.foley.setVolume(prefs.foley);
  }

  async connect(): Promise<void> {
    this.unsubscribe = this.bridge.subscribe((snapshot) => this.ingest(snapshot));
    await this.bridge.connect();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.foley.crackle(false);
  }

  get armAngleTarget(): number {
    if (!this.track) return REST_ANGLE;
    if (this.clock > 0.4) return REST_ANGLE;
    if (!this.playing && !this.scrubbing) {
      // Tras unos segundos en pausa el brazo viaja hasta su soporte lateral.
      const parked = this.pausedAt > 0 && performance.now() - this.pausedAt > PAUSE_PARK;
      return parked ? REST_ANGLE : this.needleAngle;
    }
    return this.needleAngle;
  }

  /** Ángulo que posa la aguja sobre el segundo que suena ahora mismo. */
  get needleAngle(): number {
    const ratio = this.duration > 0 ? this.progress / this.duration : 0;
    return armAngleForProgress(clamp(ratio, 0, 1));
  }

  get texture(): DiscTexture {
    return this.prefs.discTexture;
  }

  get rpm(): 33 | 45 {
    return this.prefs.rpm;
  }

  get foleyVolume(): number {
    return this.prefs.foley;
  }

  get needleDown(): boolean {
    return this.armLift < 0.18 && this.discOut > 0.9;
  }

  get settled(): boolean {
    return (
      Math.abs(this.spin) < 0.0004 &&
      Math.abs(this.armLift - (this.playing ? 0 : 1)) < 0.02 &&
      Math.abs(this.discOut - this.discTarget) < 0.005 &&
      Math.abs(this.flip - this.flipTarget) < 0.002 &&
      Math.abs(this.clock - this.clockTarget) < 0.004 &&
      Math.abs(this.clockTag - this.clockTagTarget) < 0.004
    );
  }

  private get discTarget(): number {
    if (this.clock > 0.5) return 0.42;
    if (this.track && performance.now() >= this.revealAt) return 1;
    return 0;
  }

  private get clockTarget(): number {
    if (this.clockForced) return 1;
    if (!this.playing && performance.now() - this.pausedAt > CLOCK_AFTER) return 1;
    return 0;
  }

  /**
   * Milisegundos que faltan para el próximo cambio del reloj de escritorio.
   *
   * El bucle se duerme cuando la escena queda quieta y sólo se despierta en el
   * cambio de minuto; sin este dato el reloj podía tardar hasta dos minutos en
   * asomar. `Infinity` significa "no hace falta despertarme antes del minuto":
   * o hay música sonando, o el reloj ya está a la vista y le basta el minutero.
   */
  get msUntilClock(): number {
    if (this.clockTarget === 1) return this.clock > 0.999 ? Number.POSITIVE_INFINITY : 0;
    if (this.playing) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.pausedAt + CLOCK_AFTER - performance.now());
  }

  /** ¿La hora ya está impresa en la funda? */
  get clockShown(): boolean {
    return this.clock > 0.5;
  }

  /**
   * ¿Se está enseñando el papelito con la hora? Es la versión "de día" del
   * reloj: mientras suena música y el usuario lo pidió, la hora vive en una
   * tarjeta sobre la mesa en vez de esperar al reposo.
   */
  get clockTagShown(): boolean {
    return this.clockTag > 0.5;
  }

  private get clockTagTarget(): number {
    if (!this.prefs.clockWhilePlaying) return 0;
    // Sin disco no hay tarjeta: la mesa vacía ya se convierte en reloj sola.
    if (!this.track) return 0;
    // Si manda el reloj de reposo, el fajín de la funda ya está imprimiendo la hora.
    if (this.clock > 0.35) return 0;
    return 1;
  }

  /** Atajo del panel de pruebas: entra en modo reloj sin esperar el minuto. */
  forceClock(): void {
    this.clockForced = true;
    this.pausedAt = performance.now() - CLOCK_AFTER;
    if (this.playing) this.bridge.pause();
    this.notify();
  }

  // ---------------------------------------------------------------- ingestión

  private ingest(snapshot: TrackSnapshot | null): void {
    const now = performance.now();
    this.lastSnapshotAt = now;

    if (!snapshot) {
      if (this.track) {
        this.track = null;
        this.playing = false;
        this.pausedAt = now;
        this.revealAt = now + REVEAL_DELAY;
        this.lyrics = null;
        this.lyricsStatus = 'idle';
        this.onTrackVisual?.('track');
        this.notify();
      }
      return;
    }

    const key = `${snapshot.title}|${snapshot.artist}|${snapshot.duration}`;
    const isNew = key !== this.lastTrackKey;
    if (isNew) {
      this.lastTrackKey = key;
      this.track = snapshot;
      this.duration = snapshot.duration;
      this.progress = clamp(snapshot.currentTime, 0, Math.max(0, snapshot.duration));
      this.revealAt = now + REVEAL_DELAY;
      this.textureSeed = hashString(key) % 100000;
      this.loadCover(snapshot.coverUrl);
      this.loadLyrics(snapshot);
      this.onTrackVisual?.('track');
    } else {
      this.track = snapshot;
      if (snapshot.duration > 0) this.duration = snapshot.duration;
      const drift = Math.abs(snapshot.currentTime - this.progress);
      // Saltos reales (seek desde la app de origen) o pausa: se sincroniza duro.
      if (!snapshot.isPlaying || drift > 0.9 || !this.playing) {
        this.progress = clamp(snapshot.currentTime, 0, Math.max(0, snapshot.duration));
      }
    }

    this.canSeek = snapshot.canSeek;

    if (snapshot.isPlaying !== this.playing) {
      this.playing = snapshot.isPlaying;
      if (this.playing) {
        this.pausedAt = 0;
        this.clockForced = false;
      } else {
        this.pausedAt = now;
        this.stopCrackle();
      }
      this.notify();
    }
    if (isNew) this.notify();
  }

  private loadCover(url: string | undefined): void {
    const token = ++this.imageToken;
    this.coverReady = false;
    if (!url) {
      this.cover = null;
      this.palette = defaultPalette();
      this.onTrackVisual?.('cover');
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      if (token !== this.imageToken) return;
      this.cover = image;
      this.coverReady = true;
      this.palette = paletteFromImage(image);
      this.onTrackVisual?.('cover');
      this.notify();
    };
    image.onerror = () => {
      if (token !== this.imageToken) return;
      this.cover = null;
      this.coverReady = false;
      this.palette = defaultPalette();
      this.onTrackVisual?.('cover');
    };
    image.src = url;
  }

  private loadLyrics(snapshot: TrackSnapshot): void {
    const token = ++this.lyricsToken;
    this.lyrics = null;
    this.lyricsStatus = 'loading';
    void fetchLyrics(snapshot.artist, snapshot.title, snapshot.duration).then((lyrics) => {
      if (token !== this.lyricsToken) return;
      this.lyrics = lyrics;
      this.lyricsStatus = lyrics ? 'ready' : 'missing';
      this.notify();
    });
  }

  // ------------------------------------------------------------------- física

  update(dt: number, now: number): void {
    const prefs = this.prefs;

    if (this.playing && !this.scrubbing) {
      this.progress = clamp(this.progress + dt, 0, Math.max(0.1, this.duration));
    }

    this.clock = approach(this.clock, this.clockTarget, 0.55, dt);
    this.clockTag = approach(this.clockTag, this.clockTagTarget, 0.45, dt);

    // Si el tocadiscos se duerme con la funda del revés (leyendo la letra), la
    // funda se gira sola para dejar la portada y la hora a la vista: en la mesa
    // nadie deja un disco dormido con la contraportada mirando al techo.
    if (this.clock > 0.06 && this.flipTarget === 1) {
      this.flipFrom = this.flip;
      this.flipAt = now;
      this.flipTarget = 0;
    }

    // El disco entra y sale de la funda: una sola coordenada gobierna todo.
    // Entra rápido (el gesto tiene que sentirse firme) y vuelve a salir más despacio.
    const discTau = this.discTarget > this.discOut ? 0.24 : 0.11;
    this.discOut = approach(this.discOut, this.discTarget, discTau, dt);
    this.discX =
      LAYOUT.disc.hiddenCx + (LAYOUT.disc.cx - LAYOUT.disc.hiddenCx) * this.discOut;

    // Giro: objetivo según RPM y estado mecánico.
    const rpmOmega = (prefs.rpm / 60) * Math.PI * 2;
    const needsBrake = this.braking > 0.02 || !this.playing || this.clock > 0.5 || this.discOut < 0.55;
    const targetSpin = needsBrake ? 0 : rpmOmega;
    this.spin = approach(this.spin, targetSpin, this.braking > 0.02 ? 0.085 : 0.17, dt);
    this.spinAngle = (this.spinAngle + this.spin * dt * SPIN_DISPLAY) % (Math.PI * 2);

    // Voltear la funda es un gesto de cartón: arranca despacio, pasa rápido por
    // el canto y frena. Por eso se interpola por tiempo y no exponencialmente.
    const flipT = clamp((now - this.flipAt) / FLIP_MS, 0, 1);
    const flipEase = flipT * flipT * flipT * (flipT * (flipT * 6 - 15) + 10);
    this.flip = this.flipFrom + (this.flipTarget - this.flipFrom) * flipEase;

    // Brazo: se levanta antes de viajar y baja al llegar. Con el dedo frenando
    // el plato la aguja sigue apoyada: el disco se detiene, no lo levantas tú.
    const armTarget = this.armAngleTarget;
    // Un salto grande no puede ocurrir con la púa apoyada: primero se levanta.
    // El seguimiento normal del surco queda muy por debajo de este umbral.
    const mustLift = !this.scrubbing && Math.abs(armTarget - this.armAngle) > 0.06;
    const wantDown =
      (this.playing || this.scrubbing) &&
      !mustLift &&
      this.discOut > 0.85 &&
      this.clock < 0.4 &&
      !this.dragArm;
    this.armLift = approach(this.armLift, wantDown ? 0 : 1, 0.13, dt);

    if (this.armSnapBack > 0) {
      this.armSnapBack = Math.max(0, this.armSnapBack - dt * 3.2);
    }
    if (!this.dragArm) {
      const wobble = this.armSnapBack > 0 ? Math.sin(now / 26) * 0.012 * this.armSnapBack : 0;
      const tau = this.armLift > 0.55 ? 0.5 : 0.35;
      this.armAngle = approach(this.armAngle, armTarget + wobble, tau, dt);
    }

    // Aguja: sonido al posarse, estática encendida mientras toca el surco.
    const down = this.needleDown && this.playing;
    if (down && !this.needleWasDown) {
      this.foley.needleDrop();
      this.foley.crackle(true);
      this.onChange?.();
    } else if (!down && this.needleWasDown) {
      this.foley.crackle(false);
    }
    this.needleWasDown = down;

    if (this.track && this.track.duration > 0 && this.progress >= this.track.duration - 0.05 && this.playing) {
      this.progress = this.track.duration;
    }
  }

  activeLine(): number {
    return activeLineIndex(this.lyrics, this.progress);
  }

  /**
   * Apaga la estática y deja el estado del surco listo para volver a sonar.
   *
   * Importa además del sonido: si se apagaba sin tocar `needleWasDown`, un toque
   * y suelta dentro del mismo fotograma dejaba el indicador en "aguja apoyada" y
   * al reanudar ya no se encendía el chisporroteo.
   */
  private stopCrackle(): void {
    this.foley.crackle(false);
    this.needleWasDown = false;
  }

  // -------------------------------------------------------------------- gestos

  /** Devuelve true si el gesto fue consumido por el tocadiscos. */
  pointerDown(target: 'disc' | 'label' | 'arm' | 'sleeve' | 'none', x: number, y: number): boolean {
    this.foley.unlock();

    if (this.clock > 0.15) {
      this.wake();
      return true;
    }

    if (target === 'arm') {
      this.dragArm = true;
      this.armDragAngle = Math.atan2(y - LAYOUT.arm.py, x - LAYOUT.arm.px);
      this.foley.armTouch();
      return true;
    }

    if (target === 'disc' || target === 'label') {
      this.discDownAt = performance.now();
      this.discWasPlaying = this.playing;
      this.scrubMoved = false;
      this.braking = 1;
      this.scrubbing = true;
      this.scrubStart = this.progress;
      this.scrubAngle = Math.atan2(y - LAYOUT.disc.cy, x - LAYOUT.disc.cx);
      if (this.playing) {
        void this.bridge.pause();
        this.playing = false;
        this.pausedAt = performance.now();
        this.stopCrackle();
        this.foley.switchClick(false);
      } else {
        this.pausedAt = performance.now();
      }
      this.onChange?.();
      return true;
    }

    if (target === 'sleeve') {
      this.flipTarget = this.flipTarget > 0.5 ? 0 : 1;
      this.flipFrom = this.flip;
      this.flipAt = performance.now();
      this.onChange?.();
      return true;
    }
    return false;
  }

  pointerMove(x: number, y: number): void {
    if (this.dragArm) {
      const angle = Math.atan2(y - LAYOUT.arm.py, x - LAYOUT.arm.px);
      // El recorrido va del borde exterior (ángulo menor) a la galleta (mayor):
      // pasarse de largo ponía el clamp del revés y la aguja saltaba al centro.
      const clamped = clamp(angle, ARM_ANGLE_AT_EDGE - 0.02, ARM_ANGLE_AT_LABEL);
      if (!this.canSeek) {
        // Spotify Free: la aguja no puede volver atrás. Se resiste, vibra y,
        // si insistes, vuelve sola al punto donde va la música.
        const trueAngle = this.needleAngle;
        this.armDragAngle = Math.max(clamped, trueAngle - 0.004);
        if (clamped < trueAngle - 0.01) {
          this.armSnapBack = 1;
          if (navigator.vibrate) navigator.vibrate(8);
        }
      } else {
        this.armDragAngle = clamped;
      }
      this.armAngle = this.armDragAngle;
      return;
    }

    if (this.scrubbing) {
      const angle = Math.atan2(y - LAYOUT.disc.cy, x - LAYOUT.disc.cx);
      let delta = angle - this.scrubAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      // Girar el vinilo es un arrastre, no un toque: en cuanto el dedo se mueve
      // el gesto deja de ser "pausa" y pasa a ser "buscar en el surco".
      if (Math.abs(delta) > 0.0005) this.scrubMoved = true;
      if (this.canSeek) {
        this.progress = clamp(
          this.progress + (delta / (Math.PI * 2)) * 14,
          0,
          Math.max(0.1, this.duration),
        );
      }
      // El disco acompaña el dedo aunque no se pueda hacer seek.
      // `spinAngle` positivo gira en el sentido del reloj en pantalla (el lienzo
      // tiene la Y hacia abajo), que es justo hacia donde empuja el dedo.
      this.spinAngle = (this.spinAngle + delta * (this.canSeek ? 1 : 0.25)) % (Math.PI * 2);
      this.scrubAngle = angle;
      this.onChange?.();
    }
  }

  pointerUp(): void {
    if (this.dragArm) {
      this.dragArm = false;
      const ratio = progressForArmAngle(this.armAngle);
      if (this.canSeek) {
        void this.bridge.seek(ratio * Math.max(0.1, this.duration));
        this.progress = ratio * Math.max(0.1, this.duration);
      } else {
        // Al final del disco, un salto limpio a la siguiente canción.
        if (ratio > 0.965) {
          void this.bridge.next();
        } else {
          this.armSnapBack = 1;
          this.foley.armTouch();
          if (navigator.vibrate) navigator.vibrate([6, 40, 10]);
        }
      }
      this.foley.armTouch();
      this.onChange?.();
      return;
    }

    if (this.scrubbing) {
      this.scrubbing = false;
      this.braking = 0;
      const held = performance.now() - this.discDownAt;
      const tap = held < TAP_MS && !this.scrubMoved;

      if (tap) {
        // Toque seco: es un interruptor. Si sonaba, se queda en pausa; si estaba
        // parado, arranca. Sin seek: no hubo arrastre que valga.
        this.pausedAt = performance.now();
        if (this.discWasPlaying) {
          this.playing = false;
          this.stopCrackle();
          this.foley.switchClick(false);
        } else {
          void this.bridge.play();
          this.playing = true;
          this.pausedAt = 0;
          this.foley.switchClick(true);
        }
        this.onChange?.();
        return;
      }

      // Mano apoyada: al levantar, el plato vuelve a girar donde estaba.
      if (this.canSeek) {
        void this.bridge.seek(this.progress);
      } else {
        this.progress = this.scrubStart;
      }
      void this.bridge.play();
      this.playing = true;
      this.pausedAt = 0;
      this.clockForced = false;
      this.foley.switchClick(true);
      this.onChange?.();
    }
  }

  wake(): void {
    this.clock = 0;
    this.clockForced = false;
    if (this.track) {
      void this.bridge.play();
      this.playing = true;
      this.pausedAt = 0;
    }
    this.onChange?.();
  }

  togglePlay(): void {
    this.foley.unlock();
    if (this.playing) {
      void this.bridge.pause();
      this.playing = false;
      this.pausedAt = performance.now();
      this.stopCrackle();
      this.foley.switchClick(false);
    } else {
      void this.bridge.play();
      this.playing = true;
      this.pausedAt = 0;
      this.clockForced = false;
      this.foley.switchClick(true);
      if (this.clock > 0.05) this.clock = 0;
    }
    this.onChange?.();
  }

  next(): void {
    this.foley.unlock();
    void this.bridge.next();
  }

  previous(): void {
    this.foley.unlock();
    void this.bridge.previous();
  }

  /** Salto exacto desde la línea de tiempo del panel. */
  seekTo(seconds: number): void {
    if (!this.canSeek) {
      this.armSnapBack = 0.6;
      if (navigator.vibrate) navigator.vibrate(8);
      return;
    }
    this.progress = clamp(seconds, 0, Math.max(0.1, this.duration));
    void this.bridge.seek(this.progress);
    this.onChange?.();
  }

  openSource(floating = false): void {
    void this.bridge.openSource({ floating });
  }

  /** Posición de la aguja en el arco de la funda, para el panel. */
  get revealDelay(): number {
    return Math.max(0, this.revealAt - performance.now());
  }

  get elapsedSinceSnapshot(): number {
    return performance.now() - this.lastSnapshotAt;
  }

  get scrubActive(): boolean {
    return this.scrubbing;
  }

  /** Cuánto tiembla el brazo tras un retroceso rechazado (0..1). */
  get armJitter(): number {
    return this.armSnapBack;
  }

  get snapEase(): number {
    return easeOutCubic(clamp(this.discOut, 0, 1));
  }

  private notify(): void {
    this.onChange?.();
  }
}

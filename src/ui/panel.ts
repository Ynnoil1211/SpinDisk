/**
 * Consola de control: transporte, línea de tiempo, texturas, RPM, aguja y
 * puente a la app que está sonando. Se oculta sola a los 3 s de inactividad.
 */

import type { Preferences, SourceApp } from '../core/types.js';
import type { Turntable } from '../scene/turntable.js';
import { clamp, formatTime } from '../util/math.js';

export interface PanelHandlers {
  onPreferences: (prefs: Preferences) => void;
  notify: (message: string) => void;
  onPanelMotion?: (openAmount: number, heightPx: number, dragging: boolean) => void;
}

const SOURCE_LABEL: Record<SourceApp, string> = {
  spotify: 'Spotify',
  'youtube-music': 'YouTube Music',
  youtube: 'YouTube',
  local: 'Archivos locales',
  unknown: 'La app activa',
};

const SOURCE_TINT: Record<SourceApp, string> = {
  spotify: '#1d7a4a',
  'youtube-music': '#b3352f',
  youtube: '#b3352f',
  local: '#6b5a45',
  unknown: '#6b5a45',
};

const HIDE_AFTER = 3000;
const LONG_PRESS = 480;
/** Cuánto hay que arrastrar el panel hacia abajo para devolverlo a su sitio. */
const HIDE_SWIPE = 64;
/** Debajo de esto el gesto todavía puede ser un toque. */
const SWIPE_SLOP = 14;

export class ConsolePanel {
  isOpen = false;

  private root: HTMLElement;
  private turntable: Turntable;
  private prefs: Preferences;
  private handlers: PanelHandlers;

  private hideTimer = 0;
  private pressTimer = 0;
  private pressing = false;
  private dragging = false;
  /** Arrastre vertical del panel para devolverlo a su sitio. */
  private swipeFromY: number | null = null;
  private swipeFromX = 0;
  private swipeDelta = 0;

  private fill: HTMLElement;
  private knob: HTMLElement;
  private input: HTMLInputElement;
  private timelineModule: HTMLElement;
  private nowEl: HTMLElement;
  private leftEl: HTMLElement;
  private stateEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private sourceBtn: HTMLButtonElement;
  private sourceName: HTMLElement;
  private badge: HTMLElement;
  private foley: HTMLInputElement;
  private inner: HTMLElement | null = null;
  private isPanning = false;
  private panStartX = 0;
  private panStartScroll = 0;

  constructor(root: HTMLElement, turntable: Turntable, prefs: Preferences, handlers: PanelHandlers) {
    this.root = root;
    this.turntable = turntable;
    this.prefs = prefs;
    this.handlers = handlers;

    const q = <T extends HTMLElement>(id: string): T => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Falta #${id} en el documento`);
      return el as T;
    };

    this.fill = q('track-fill');
    this.knob = q('track-knob');
    this.input = q<HTMLInputElement>('timeline');
    this.timelineModule = this.input.closest('.module') as HTMLElement;
    this.nowEl = q('t-now');
    this.leftEl = q('t-left');
    this.stateEl = q('t-state');
    this.playBtn = q<HTMLButtonElement>('btn-play');
    this.sourceBtn = q<HTMLButtonElement>('source');
    this.sourceName = q('source-name');
    this.badge = q('source-badge');
    this.foley = q<HTMLInputElement>('foley');
    this.inner = this.root.querySelector<HTMLElement>('.console__inner');

    this.bind();
    this.refresh();
  }

  private bind(): void {
    this.root.addEventListener('pointerdown', () => this.arm());
    this.root.addEventListener('pointermove', () => this.arm());
    this.bindSwipeDown();
    this.bindHorizontalScroll();
    this.root.addEventListener('focusin', () => this.arm());

    this.q('btn-prev').addEventListener('click', () => {
      this.turntable.previous();
      this.refresh();
      this.arm();
    });
    this.playBtn.addEventListener('click', () => {
      this.turntable.togglePlay();
      this.refresh();
      this.arm();
    });
    this.q('btn-next').addEventListener('click', () => {
      this.turntable.next();
      this.refresh();
      this.arm();
    });

    this.input.addEventListener('pointerdown', () => {
      this.dragging = true;
    });
    this.input.addEventListener('input', () => {
      // En Spotify Free el pulgar no se mueve: la línea está bloqueada y el
      // control vuelve solo a donde va la música.
      if (!this.turntable.canSeek) {
        this.paint(this.ratio());
        return;
      }
      const ratio = Number(this.input.value) / 1000;
      this.paint(ratio);
    });
    const commit = (): void => {
      this.dragging = false;
      // En Free no se pide siquiera la búsqueda: el control vuelve solo.
      if (!this.turntable.canSeek) {
        this.paint(this.ratio());
        this.arm();
        return;
      }
      const ratio = Number(this.input.value) / 1000;
      this.turntable.seekTo(ratio * Math.max(0.1, this.turntable.duration));
      this.arm();
    };
    this.input.addEventListener('change', commit);
    this.input.addEventListener('pointerup', () => {
      if (this.dragging) this.dragging = false;
    });

    this.root.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => {
      button.addEventListener('click', () => {
        const texture = button.dataset.texture;
        if (!texture) return;
        this.prefs.discTexture = texture as Preferences['discTexture'];
        this.applyPreferences();
        this.handlers.notify('Textura: ' + (button.title || texture));
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#rpm-switch button').forEach((button) => {
      button.addEventListener('click', () => {
        const rpm = button.dataset.rpm === '45' ? 45 : 33;
        this.prefs.rpm = rpm;
        this.applyPreferences();
        this.handlers.notify(rpm === 45 ? '45 RPM · sólo cambia el giro visual' : '33⅓ RPM');
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#clock-switch button').forEach((button) => {
      button.addEventListener('click', () => {
        const on = button.dataset.clock === 'on';
        this.prefs.clockWhilePlaying = on;
        this.applyPreferences();
        this.handlers.notify(
          on
            ? 'Reloj a la vista · la hora se queda en la mesa mientras suena'
            : 'Reloj de día apagado',
        );
      });
    });

    this.foley.addEventListener('input', () => {
      this.prefs.foley = clamp(Number(this.foley.value) / 100, 0, 1);
      this.applyPreferences(false);
    });
    this.foley.addEventListener('change', () => this.arm());

    // Toque = abrir la app. Mantener = ventana flotante / pantalla dividida.
    this.sourceBtn.addEventListener('pointerdown', () => {
      this.pressing = true;
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => {
        if (!this.pressing) return;
        this.pressing = false;
        this.turntable.openSource(true);
        this.handlers.notify('Abriendo en ventana flotante…');
      }, LONG_PRESS);
    });
    const release = (): void => {
      window.clearTimeout(this.pressTimer);
      if (this.pressing) {
        this.pressing = false;
        this.turntable.openSource(false);
      }
      this.arm();
    };
    this.sourceBtn.addEventListener('pointerup', release);
    this.sourceBtn.addEventListener('pointercancel', () => {
      this.pressing = false;
      window.clearTimeout(this.pressTimer);
    });
    this.sourceBtn.addEventListener('pointerleave', () => {
      this.pressing = false;
      window.clearTimeout(this.pressTimer);
    });
  }

  private q(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Falta #${id}`);
    return el;
  }

  private applyPreferences(redraw = true): void {
    this.handlers.onPreferences(this.prefs);
    if (redraw) this.refresh();
  }

  /**
   * El gesto de abrir, al revés: arrastrar el panel hacia abajo lo devuelve a su
   * sitio sin esperar los tres segundos. Se ignora si empieza sobre un control
   * que ya usa el arrastre (la línea de tiempo o un selector) o si el gesto va
   * más en horizontal que en vertical, para no pisar el desplazamiento de la
   * fila de módulos en pantallas estrechas.
   */
  private bindSwipeDown(): void {
    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, .swatch, .module--source')) {
        this.swipeFromY = null;
        return;
      }
      this.swipeFromY = event.clientY;
      this.swipeFromX = event.clientX;
      this.swipeDelta = 0;
    });

    this.root.addEventListener('pointermove', (event) => {
      if (this.swipeFromY === null) return;
      const dy = event.clientY - this.swipeFromY;
      const dx = event.clientX - this.swipeFromX;
      if (dy < SWIPE_SLOP || Math.abs(dx) > Math.abs(dy)) return;
      this.swipeDelta = dy;
      this.root.style.transform = `translateY(${dy.toFixed(0)}px)`;
      this.root.style.opacity = String(Math.max(0.3, 1 - dy / 300));
      this.emitMotion(true);
    });

    const drop = (): void => {
      if (this.swipeFromY === null) return;
      const travelled = this.swipeDelta;
      this.swipeFromY = null;
      this.swipeDelta = 0;
      this.root.style.transform = '';
      this.root.style.opacity = '';
      if (travelled > HIDE_SWIPE) {
        this.close();
      } else {
        this.emitMotion(false);
        this.arm();
      }
    };
    this.root.addEventListener('pointerup', drop);
    this.root.addEventListener('pointercancel', drop);
  }

  /**
   * Permite rodar / desplazar el panel horizontalmente cuando el ancho de
   * pantalla no da para ver todos los módulos a la vez. Funciona con dedo
   * (táctil nativo con pan-x) y con ratón arrastrando la fila.
   */
  private bindHorizontalScroll(): void {
    if (!this.inner) return;
    this.inner.addEventListener('scroll', () => {
      this.arm();
      this.updateScrollHints();
    });

    this.inner.addEventListener('pointerdown', (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, button, a')) return;
      this.isPanning = true;
      this.panStartX = event.clientX;
      this.panStartScroll = this.inner ? this.inner.scrollLeft : 0;
    });

    window.addEventListener('pointermove', (event: PointerEvent) => {
      if (!this.isPanning || !this.inner) return;
      const dx = event.clientX - this.panStartX;
      if (Math.abs(dx) > 3) {
        this.inner.scrollLeft = this.panStartScroll - dx;
        this.arm();
        this.updateScrollHints();
      }
    });

    const stopPan = (): void => {
      this.isPanning = false;
    };
    window.addEventListener('pointerup', stopPan);
    window.addEventListener('pointercancel', stopPan);
    window.addEventListener('resize', () => this.updateScrollHints());
  }

  updateScrollHints(): void {
    if (!this.inner) return;
    const scrollLeft = this.inner.scrollLeft || 0;
    const clientWidth = this.inner.clientWidth || 0;
    const scrollWidth = this.inner.scrollWidth || 0;
    const canLeft = scrollLeft > 6;
    const canRight = scrollWidth > clientWidth && scrollLeft + clientWidth < scrollWidth - 6;
    this.root.classList.toggle('has-scroll-left', canLeft);
    this.root.classList.toggle('has-scroll-right', canRight);
  }

  open(): void {
    if (this.isOpen) {
      this.arm();
      return;
    }
    this.isOpen = true;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-panel');
    this.refresh();
    this.updateScrollHints();
    this.emitMotion(false);
    this.arm();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-panel');
    window.clearTimeout(this.hideTimer);
    // Si se cierra a mitad de un arrastre, el desplazamiento se queda pegado:
    // hay que limpiarlo para que la próxima vez aparezca en su sitio.
    this.swipeFromY = null;
    this.swipeDelta = 0;
    this.root.style.transform = '';
    this.root.style.opacity = '';
    this.emitMotion(false);
    if (this.root.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private emitMotion(dragging: boolean): void {
    const h = (this.root.offsetHeight || 116) + 16;
    const amount = !this.isOpen ? 0 : clamp(1 - this.swipeDelta / 120, 0, 1);
    this.handlers.onPanelMotion?.(amount, h, dragging);
  }

  /** Reinicia la cuenta atrás de 3 s. */
  arm(): void {
    if (!this.isOpen) return;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.close(), HIDE_AFTER);
  }

  private paint(ratio: number): void {
    const pct = `${(ratio * 100).toFixed(2)}%`;
    this.fill.style.width = pct;
    this.knob.style.left = pct;
    this.input.value = String(Math.round(ratio * 1000));
  }

  private ratio(): number {
    const duration = this.turntable.duration > 0 ? this.turntable.duration : 0;
    return duration > 0 ? clamp(this.turntable.progress / duration, 0, 1) : 0;
  }

  refresh(): void {
    const tt = this.turntable;
    const duration = tt.duration > 0 ? tt.duration : 0;
    const ratio = this.ratio();

    document.body.classList.toggle('is-playing', tt.playing);
    document.body.classList.toggle('is-sleeping', tt.clock > 0.6);

    if (!this.dragging) this.paint(ratio);
    this.nowEl.textContent = formatTime(tt.progress);
    this.leftEl.textContent = `-${formatTime(Math.max(0, duration - tt.progress))}`;

    const locked = !tt.canSeek;
    this.timelineModule.classList.toggle('is-locked', locked);
    this.input.setAttribute('aria-disabled', locked ? 'true' : 'false');

    const state = locked
      ? 'Free · sin retroceso'
      : tt.clock > 0.5
        ? 'reposo'
        : !tt.playing
          ? 'en pausa'
          : 'escuchando';
    this.stateEl.textContent = state;
    this.stateEl.classList.toggle('pill--locked', locked);

    this.playBtn.setAttribute('aria-label', tt.playing ? 'Pausar' : 'Reproducir');

    const source = tt.track?.source ?? 'spotify';
    const label = SOURCE_LABEL[source];
    if (this.sourceName.textContent !== label) {
      this.sourceName.textContent = label;
      this.sourceBtn.setAttribute('aria-label', `Abrir ${label}`);
    }
    this.badge.style.color = SOURCE_TINT[source];

    this.root.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.texture === this.prefs.discTexture);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#rpm-switch button').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.rpm === String(this.prefs.rpm));
    });
    this.root.querySelectorAll<HTMLButtonElement>('#clock-switch button').forEach((button) => {
      const on = button.dataset.clock === 'on';
      button.classList.toggle('is-active', on === this.prefs.clockWhilePlaying);
    });

    const foleyValue = String(Math.round(this.prefs.foley * 100));
    if (this.foley.value !== foleyValue && document.activeElement !== this.foley) {
      this.foley.value = foleyValue;
    }
  }
}

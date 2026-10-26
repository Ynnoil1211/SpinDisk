/**
 * SpinDisk · punto de entrada.
 *
 * Aquí se elige el puente (Sandbox en el navegador, MediaSession en la tablet),
 * se monta la escena y se corre el bucle con tasa de refresco adaptativa.
 */

import type { PlayerBridge } from './core/types.js';
import { loadPreferences, savePreferences } from './core/store.js';
import { AndroidBridge, NATIVE_NOTICE, isNativeShell } from './bridge/android.js';
import { SandboxBridge } from './bridge/sandbox.js';
import { Scene } from './scene/renderer.js';
import { Turntable } from './scene/turntable.js';
import { DESIGN, hitTest } from './scene/layout.js';
import { ConsolePanel } from './ui/panel.js';
import { mountSandbox } from './ui/sandbox.js';
import { createToast } from './ui/toast.js';
import { Banner } from './ui/banner.js';

const canvas = document.getElementById('stage');
const consoleEl = document.getElementById('console');
const toastEl = document.getElementById('toast');
const bannerEl = document.getElementById('banner');
if (!canvas || !consoleEl || !toastEl || !bannerEl) {
  throw new Error('Falta estructura base en el documento');
}

const notify = createToast(toastEl);
const preferences = loadPreferences();
/** `?shot` deja la escena limpia para las capturas de verificación. */
const SHOT = new URLSearchParams(location.search).has('shot');
const native = isNativeShell();
const bridge: PlayerBridge = native ? new AndroidBridge() : new SandboxBridge();

const turntable = new Turntable(bridge, preferences);
const scene = new Scene(canvas as HTMLCanvasElement, turntable);
const panel = new ConsolePanel(consoleEl, turntable, preferences, {
  onPreferences: (prefs) => {
    turntable.setPreferences(prefs);
    savePreferences(prefs);
  },
  notify,
});
const sandbox = native
  ? null
  : mountSandbox(bridge as SandboxBridge, notify, {
      forceClock: () => turntable.forceClock(),
      clockIn: () => turntable.msUntilClock,
      isClock: () => turntable.clockShown,
    });

// ------------------------------------------------------------------ interacción

let activePointer: number | null = null;

// El motor Foley necesita un gesto para arrancar. Vale cualquiera: abrir la
// consola, tocar la lona o pulsar un botón; si no, un disco que ya venía
// sonando al abrir la app nunca chisporrotearía.
window.addEventListener('pointerdown', () => turntable.foley.unlock(), { once: true });

// En la tablet, la capa nativa avisa por aquí (permiso de notificaciones,
// ventana flotante no disponible, etc.).
window.addEventListener(NATIVE_NOTICE, (event) => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail === 'string' && detail) notify(detail, 5200);
});

const toDesign = (event: PointerEvent): { x: number; y: number } =>
  scene.toDesign(event.clientX, event.clientY);

canvas.addEventListener('pointerdown', (event) => {
  if (activePointer !== null) return;
  turntable.foley.unlock();
  const { x, y } = toDesign(event);

  // Borde inferior o esquina superior izquierda: aparece la consola.
  if (y > DESIGN.height - 30 || (x < 76 && y < 76)) {
    panel.open();
    return;
  }

  const target = hitTest(x, y, turntable.armAngle);
  if (!turntable.pointerDown(target, x, y)) return;
  activePointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  kick();
});

canvas.addEventListener('pointermove', (event) => {
  if (activePointer === event.pointerId) {
    const { x, y } = toDesign(event);
    turntable.pointerMove(x, y);
    kick();
    return;
  }
  if (event.pointerType === 'mouse') {
    const { x, y } = toDesign(event);
    const target = hitTest(x, y, turntable.armAngle);
    canvas.style.cursor =
      target === 'disc' || target === 'label' || target === 'arm'
        ? 'grab'
        : target === 'sleeve'
          ? 'pointer'
          : 'default';
  }
});

const endGesture = (event: PointerEvent): void => {
  if (activePointer !== event.pointerId) return;
  activePointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  turntable.pointerUp();
  kick();
};

canvas.addEventListener('pointerup', (event) => {
  if (activePointer === null) {
    // Toque suelto sobre el borde: la consola ya se abrió y se queda sola 3 s.
    return;
  }
  endGesture(event);
});
canvas.addEventListener('pointercancel', (event) => {
  if (activePointer === event.pointerId) endGesture(event);
});

document.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const key = event.key;
  if (key === 'F2') {
    event.preventDefault();
    sandbox?.toggle();
    return;
  }
  if (key === 'Escape') {
    panel.close();
    sandbox?.close();
    return;
  }
  if (key === ' ') {
    event.preventDefault();
    turntable.togglePlay();
    kick();
    return;
  }
  if (key === 'ArrowRight') {
    turntable.next();
    return;
  }
  if (key === 'ArrowLeft') {
    turntable.previous();
    return;
  }
  if (key === 'f' || key === 'F') {
    turntable.pointerDown('sleeve', 0, 0);
    kick();
  }
});

// ------------------------------------------------------------------------ bucle

let last = performance.now();
let raf = 0;
let idleTimer = 0;
let lastPanelSync = 0;

function scheduleIdle(): void {
  if (idleTimer) return;
  // Dos despertares: el cambio de minuto del reloj y el momento exacto en que
  // el tocadiscos entra en reposo. Sin el segundo, el reloj podía tardar hasta
  // dos minutos en asomar desde que se pausa la música.
  const now = new Date();
  const toMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  const toClock = turntable.msUntilClock;
  const ms = Math.min(toMinute, Number.isFinite(toClock) ? toClock + 40 : Number.POSITIVE_INFINITY);
  idleTimer = window.setTimeout(
    () => {
      idleTimer = 0;
      last = performance.now();
      frame(performance.now());
    },
    Math.max(240, ms + 60),
  );
}

function frame(now: number): void {
  raf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;

  turntable.update(dt, now);
  scene.render(now);

  if (turntable.settled && !turntable.playing && activePointer === null) {
    scheduleIdle();
    return;
  }
  raf = requestAnimationFrame(frame);
}

function kick(): void {
  if (idleTimer) {
    window.clearTimeout(idleTimer);
    idleTimer = 0;
  }
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

window.addEventListener('resize', () => {
  scene.resize();
  kick();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else {
    kick();
  }
});

// La consola se refresca sola mientras exista algo que contar.
window.setInterval(() => {
  if (document.hidden) return;
  const now = performance.now();
  if (now - lastPanelSync < 190) return;
  lastPanelSync = now;
  panel.refresh();
  sandbox?.sync();
}, 120);

// ------------------------------------------------------------------------ boot

turntable.onChange = () => {
  panel.refresh();
  kick();
};

const boot = async (): Promise<void> => {
  scene.resize();
  scene.render(performance.now());
  try {
    await turntable.connect();
  } catch (error) {
    notify('No se pudo conectar con la sesión de música');
    console.error(error);
  }
  kick();

  if (!native) {
    if (!SHOT) notify('F2 abre el panel de pruebas', 3600);
    window.setTimeout(() => {
      if (!SHOT && !turntable.track) sandbox?.open();
    }, 1400);
    return;
  }

  // En la tablet: si nadie ha dado acceso a las notificaciones, el disco no
  // puede girar. Se pide una vez, con un aviso que no se va solo.
  const android = bridge as AndroidBridge;
  const banner = new Banner(bannerEl, { onAction: () => android.requestNotificationAccess() });
  if (!android.notificationAccess()) {
    banner.show(
      'Para leer lo que suena, SpinDisk necesita acceso a las notificaciones. Actívalo y vuelve.',
    );
  }
};

void boot();

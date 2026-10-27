// Entorno mínimo para correr la escena real sin navegador.
//
// Compila `src/` y monta los shims que el motor visual espera del DOM: reloj
// falso, `Image`, `canvas`, `localStorage` y `navigator`. Lo usan tanto la vista
// previa (`preview.mjs`) como el banco de física (`sim.mjs`), de modo que ambos
// midan exactamente el mismo código que se instala en la tablet.

import { createCanvas, GlobalFonts, Image as SkiaImage } from '@napi-rs/canvas';
import { compile, loadProject } from './tsc-project.mjs';

export const WIDTH = 1280;
export const HEIGHT = 800;
export const FPS = 60;
export const STEP = 1000 / FPS;

/** Reloj falso compartido: todo lo que la escena cree medir sale de aquí. */
export const clock = { now: 0 };

const FONTS = [
  ['C:/Windows/Fonts/georgia.ttf', 'Georgia'],
  ['C:/Windows/Fonts/georgiab.ttf', 'Georgia'],
  ['C:/Windows/Fonts/georgiai.ttf', 'Georgia'],
  ['C:/Windows/Fonts/segoeui.ttf', 'Segoe UI'],
  ['C:/Windows/Fonts/segoeuib.ttf', 'Segoe UI'],
  ['C:/Windows/Fonts/consola.ttf', 'Consolas'],
];

const define = (name, value) =>
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

export const installFonts = () => {
  for (const [file, family] of FONTS) {
    try {
      GlobalFonts.registerFromPath(file, family);
    } catch {
      /* la fuente no existe en esta máquina: seguimos con la de reserva */
    }
  }
};

class HarnessImage extends SkiaImage {
  #source = '';
  get src() {
    return this.#source;
  }
  set src(value) {
    this.#source = value;
    super.src = value;
    setTimeout(() => this.onload?.({ type: 'load' }), 0);
  }
  get currentSrc() {
    return this.#source;
  }
}

export const makeCanvas = (width = WIDTH, height = HEIGHT) => {
  const canvas = createCanvas(width, height);
  canvas.style = {};
  return canvas;
};

export const installDom = ({ offline = false } = {}) => {
  const storage = new Map();
  const bus = new Map();
  globalThis.window = {
    innerWidth: WIDTH,
    innerHeight: HEIGHT,
    devicePixelRatio: 1,
    addEventListener(type, listener) {
      const set = bus.get(type) ?? new Set();
      set.add(listener);
      bus.set(type, set);
    },
    removeEventListener(type, listener) {
      bus.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of bus.get(event.type) ?? []) listener(event);
      return true;
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    // El SandboxBridge late con temporizadores reales: sin estos dos no arranca.
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error(`createElement(${tag}) no está simulado`);
      return makeCanvas();
    },
    addEventListener() {},
    hidden: false,
  };
  define('Image', HarnessImage);
  define('HTMLCanvasElement', createCanvas(1, 1).constructor);
  define('HTMLImageElement', HarnessImage);
  define('navigator', { vibrate() {}, userAgent: 'spindisk-harness' });
  define('location', { search: '' });
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  // Sólo se falsea el reloj: undici necesita el resto de `performance` intacto.
  Object.defineProperty(globalThis.performance, 'now', {
    value: () => clock.now,
    writable: true,
    configurable: true,
  });
  if (offline) {
    // Sin red: LRCLIB responde "no hay letra" al instante y nada queda en vuelo.
    define('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));
  }
};

/** Compila el proyecto en memoria y deja `dist/` listo para importar. */
export const build = () => {
  const project = loadProject(process.cwd(), { noEmit: false });
  const built = compile(project);
  if (!built.ok) {
    process.stderr.write(built.text);
    process.exit(1);
  }
};

export const loadScene = async () => {
  const [{ Scene }, { Turntable }, { DEFAULT_PREFERENCES }, layout] = await Promise.all([
    import('../dist/scene/renderer.js'),
    import('../dist/scene/turntable.js'),
    import('../dist/core/types.js'),
    import('../dist/scene/layout.js'),
  ]);
  return { Scene, Turntable, DEFAULT_PREFERENCES, LAYOUT: layout.LAYOUT };
};

/** Avanza `frames` fotogramas de 60 Hz con el reloj falso. */
export const makeTick = (turntable) => (frames = 1) => {
  for (let index = 0; index < frames; index += 1) {
    clock.now += STEP;
    turntable.update(STEP / 1000, clock.now);
  }
};

/** Simula el paso del tiempo sin tocar la simulación (para pausas largas). */
export const sleepMs = (ms) => {
  clock.now += ms;
};

/**
 * Puente de mentira con memoria: apunta cada comando que recibe el motor,
 * para poder afirmar que un gesto llamó (o no) a pause/seek/next.
 */
export class StubBridge {
  kind = 'sandbox';
  snapshot = null;
  calls = [];
  listener = null;
  seekAccepts = true;

  async connect() {
    this.listener?.(this.snapshot);
  }
  subscribe(listener) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  emit() {
    this.listener?.(this.snapshot);
  }
  load(track) {
    this.snapshot = track;
    this.emit();
  }
  patch(changes) {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, ...changes };
    this.emit();
  }
  play() {
    this.calls.push('play');
    this.patch({ isPlaying: true });
  }
  pause() {
    this.calls.push('pause');
    this.patch({ isPlaying: false });
  }
  next() {
    this.calls.push('next');
  }
  previous() {
    this.calls.push('previous');
  }
  async seek(seconds) {
    this.calls.push(`seek:${seconds.toFixed(2)}`);
    return this.seekAccepts;
  }
  openSource(options) {
    this.calls.push(`source:${options?.floating ? 'floating' : 'tap'}`);
  }
  clear() {
    this.calls = [];
  }
}

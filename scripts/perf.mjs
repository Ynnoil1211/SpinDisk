/**
 * F9 · Caracterización del motor visual.
 *
 * Este banco NO dicta veredicto sobre la fluidez: aquí el lienzo se rasteriza
 * con Skia sobre CPU (Node, sin GPU), mientras que la tablet dibuja el mismo
 * canvas con la GPU del WebView. Los milisegundos de abajo son, por tanto, un
 * techo pesimista, útil para comparar estados entre sí y para cazar fugas y
 * picos, no para aprobar o suspender el rendimiento.
 *
 * Lo que sí se comprueba aquí, porque no depende de la GPU:
 *   · que 400 fotogramas no dejen memoria creciente (fuga real),
 *   · que generar la textura de un disco nuevo quepa en un hueco visible.
 *
 * Se mide en el peor caso de la tablet: 1280×800 CSS con densidad 2, o sea un
 * lienzo de 2560×1600. `performance.now` está falseado por el arnés, así que
 * los tiempos se toman con `process.hrtime`.
 */

import {
  STEP,
  StubBridge,
  build,
  clock,
  installDom,
  installFonts,
  loadScene,
  sleepMs,
} from './harness.mjs';

installFonts();
installDom({ offline: true });
build();

const { Scene, Turntable, DEFAULT_PREFERENCES } = await loadScene();

const round = (value, decimals = 2) => Number(value.toFixed(decimals));
const mb = (bytes) => `${round(bytes / (1024 * 1024), 1)} MB`;

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${label.padEnd(50, '.')} ${detail}\n`);
};
const report = (label, detail) => {
  process.stdout.write(`  · ${label.padEnd(50, '.')} ${detail}\n`);
};

const track = {
  title: 'Derrotado En El Dolor',
  artist: 'Kaleth Morales',
  album: 'Cambia El Mundo',
  coverUrl: null,
  currentTime: 12,
  duration: 245,
  isPlaying: true,
  canSeek: true,
  source: 'spotify',
};

window.devicePixelRatio = 2;
const canvas = document.createElement('canvas');
const bridge = new StubBridge();
const turntable = new Turntable(bridge, { ...DEFAULT_PREFERENCES, foley: 0 });
const scene = new Scene(canvas, turntable);

const baseline = process.memoryUsage();
scene.resize();

const renderMs = () => {
  const started = process.hrtime.bigint();
  scene.render(clock.now);
  return Number(process.hrtime.bigint() - started) / 1e6;
};

const frame = () => {
  clock.now += STEP;
  turntable.update(STEP / 1000, clock.now);
  return renderMs();
};

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    mean,
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
  };
};

const measure = (count) => stats(Array.from({ length: count }, () => frame()));

process.stdout.write('\nMotor visual · peor caso de la tablet (CPU, sin GPU)\n');
process.stdout.write(`  lienzo ${canvas.width}×${canvas.height} · dpr ${window.devicePixelRatio}\n`);

bridge.load(track);
await turntable.connect();
for (let index = 0; index < 150; index += 1) frame();
const engine = process.memoryUsage();

// ── Coste de dibujar el mismo estado cuarenta veces ────────────────────────
// La diferencia entre el mínimo y el máximo separa el dibujo de verdad de los
// picos de recolección de basura.
const same = stats(Array.from({ length: 40 }, () => renderMs()));
report('dibujar el mimo estado (min / mediana / máx)', `${round(same.min)} / ${round(same.median)} / ${round(same.max)} ms`);

const playing = measure(240);
report(
  'girando (mediana / media / p95)',
  `${round(playing.median)} / ${round(playing.mean)} / ${round(playing.p95)} ms`,
);
report('girando (peor fotograma)', `${round(playing.max)} ms`);

// ── Reposo: disco dentro de la funda y el fajín con la hora ────────────────
turntable.togglePlay();
sleepMs(60_000);
for (let index = 0; index < 120; index += 1) frame();
const sleeping = measure(90);
report(
  'dormido (mediana / media / p95)',
  `${round(sleeping.median)} / ${round(sleeping.mean)} / ${round(sleeping.p95)} ms`,
);
const ratio = sleeping.median === 0 ? 0 : playing.median / sleeping.median;
report('girando ÷ dormido (mediana)', `${round(ratio)}× · el ahorro de energía debe ser ≥ 1`);

// ── Memoria del motor ──────────────────────────────────────────────────────
report('memoria del motor visual (RSS)', `${mb(engine.rss - baseline.rss)} · presupuesto 60 MB`);
report('heap de JavaScript', `${mb(engine.heapUsed)}`);

// ── Dos tandas iguales: una fuga se vería como crecimiento sostenido ───────
// Con `--expose-gc` cada tanda empieza con la basura recogida, así que la
// comparación mide memoria retenida y no el humor del recolector.
const phase = () => {
  globalThis.gc?.();
  const before = process.memoryUsage();
  for (let index = 0; index < 400; index += 1) frame();
  globalThis.gc?.();
  const after = process.memoryUsage();
  return { rss: after.rss - before.rss, heap: after.heapUsed - before.heapUsed };
};
const first = phase();
const second = phase();
// La memoria de Skia (RSS) sube y baja con su propia arena: se informa, no se
// aprueba. Lo que sí se puede afirmar es si el heap de JavaScript se retiene.
report('RSS de dos tandas de 400 fotogramas', `tanda 1 ${mb(first.rss)} · tanda 2 ${mb(second.rss)}`);
check(
  'sin fuga de objetos: el heap se mantiene',
  second.heap <= 4 * 1024 * 1024,
  `tanda 1 ${mb(first.heap)} · tanda 2 ${mb(second.heap)}`,
);

// ── Textura nueva: el fotograma que paga el cambio de disco ────────────────
// Tres generaciones y se toma la mediana: el primer intento paga cachés frías.
const textures = [];
for (let index = 0; index < 3; index += 1) {
  turntable.onTrackVisual?.('track');
  textures.push(renderMs());
}
textures.sort((a, b) => a - b);
const textureFrame = textures[1];
check(
  'primera textura de un disco nuevo',
  textureFrame <= 250,
  `${round(textureFrame, 1)} ms · ocurre con el disco todavía dentro de la funda`,
);

process.stdout.write(
  `\n  ${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'sin fugas y dentro de los huecos de tiempo' : `${failures} comprobación(es) fallida(s)`}\n\n`,
);
process.exit(failures === 0 ? 0 : 1);

// Vista previa fuera del navegador. Compila src/ y dibuja la escena sobre un
// lienzo Skia nativo (@napi-rs/canvas), de modo que se puede revisar el arte
// sin abrir Chrome:  node scripts/preview.mjs track
//
// Escenarios: desk · track · flip · clock · free · liner · nolyrics · instrumental · flipmid

import { mkdir, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import {
  HEIGHT,
  STEP,
  StubBridge,
  WIDTH,
  build,
  clock,
  installDom,
  installFonts,
  loadScene,
  makeCanvas,
  makeTick,
} from './harness.mjs';

const scenario = (process.argv[2] ?? 'desk').toLowerCase();
/** El reverso de la carátula es la fase F4; el resto son escenas de F1/F2. */
const LINER = new Set(['liner', 'nolyrics', 'instrumental', 'flipmid']);
/** El reloj de día (la hora mientras suena) es la fase F5. */
const CLOCK = new Set(['clocktag']);
const prefix = LINER.has(scenario) ? 'f4' : CLOCK.has(scenario) ? 'f5' : 'f1';
const outFile = path.resolve('docs/captures', `${prefix}-${scenario}.png`);
const FAKE_FPS = 1000 / STEP;

installFonts();
installDom();
build();

const { Scene, Turntable, DEFAULT_PREFERENCES, LAYOUT } = await loadScene();

// ------------------------------------------------------------------ pista real
const ARTIST = 'Kaleth Morales';
const TITLE = 'Derrotado En El Dolor';

const fetchArtwork = async () => {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      `${TITLE} ${ARTIST}`,
    )}&entity=song&limit=1`;
    const response = await fetch(url);
    const data = await response.json();
    const raw = data?.results?.[0]?.artworkUrl100 ?? '';
    if (!raw) return '';
    const big = raw.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    const image = await fetch(big);
    const buffer = Buffer.from(await image.arrayBuffer());
    await mkdir(path.resolve('docs/captures'), { recursive: true });
    const file = path.resolve('docs/captures/_cover.jpg');
    await writeFile(file, buffer);
    return file;
  } catch {
    return '';
  }
};

const needsTrack = scenario !== 'desk';
const cover = needsTrack ? await fetchArtwork() : '';
const bridge = new StubBridge();
const turntable = new Turntable(bridge, { ...DEFAULT_PREFERENCES });
const canvas = makeCanvas();
const scene = new Scene(canvas, turntable);
scene.resize();
await turntable.connect();
const tick = makeTick(turntable);

if (needsTrack) {
  bridge.load({
    title: TITLE,
    artist: ARTIST,
    album: 'Cambia El Mundo',
    coverUrl: cover,
    currentTime: 62,
    duration: 245,
    isPlaying: scenario !== 'clock',
    canSeek: scenario !== 'free',
    source: 'spotify',
  });
  // La portada y la letra llegan por red: esperamos de verdad, no en tiempo falso.
  const needsLyrics = scenario === 'flip' || LINER.has(scenario);
  await new Promise((resolve) => setTimeout(resolve, needsLyrics ? 2800 : 1400));

  // Los dos casos sin letra se fuerzan aquí: en la tablet los marca el puente
  // cuando LRCLIB no tiene nada, y así se pueden mirar sin depender del archivo.
  if (scenario === 'nolyrics') {
    turntable.lyrics = null;
    turntable.lyricsStatus = 'missing';
  }
  if (scenario === 'instrumental') {
    turntable.lyrics = {
      lines: [],
      synced: false,
      plain: '',
      instrumental: true,
    };
    turntable.lyricsStatus = 'ready';
  }
}

tick(90);

if (scenario === 'flip' || LINER.has(scenario)) {
  turntable.pointerDown('sleeve', LAYOUT.sleeve.cx, LAYOUT.sleeve.cy);
  // 'flipmid' se queda a mitad del giro para mirar el canto del cartón.
  tick(scenario === 'flipmid' ? 12 : 160);
}

if (scenario === 'clock') {
  tick(70 * FAKE_FPS);
}

// El caso que reportó el usuario: dormir con la letra a la vista. La funda debe
// girarse sola y la hora tiene que verse igual.
if (scenario === 'clocksleep') {
  turntable.pointerDown('sleeve', LAYOUT.sleeve.cx, LAYOUT.sleeve.cy);
  tick(120);
  turntable.togglePlay();
  tick(70 * FAKE_FPS);
}

if (scenario === 'free') {
  turntable.pointerDown('arm', LAYOUT.arm.px, LAYOUT.arm.py);
  turntable.pointerMove(LAYOUT.disc.cx - 40, LAYOUT.disc.cy);
  tick(30);
}

// Estado imposible en vivo (el tocadiscos gira la funda solo): sirve para
// comprobar que el fajín se imprime sin espejo sobre la contraportada.
if (scenario === 'clockback') {
  turntable.togglePlay();
  tick(70 * FAKE_FPS);
  turntable.flipTarget = 1;
  turntable.flipFrom = 1;
  turntable.flip = 1;
  turntable.flipAt = clock.now - 1000;
}

// Reloj de día: la hora impresa en un papelito mientras la música suena.
if (scenario === 'clocktag') {
  turntable.setPreferences({ ...DEFAULT_PREFERENCES, clockWhilePlaying: true });
  tick(60);
}

scene.render(clock.now);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, canvas.toBuffer('image/png'));
const size = statSync(outFile).size;
console.log(`✓ ${path.basename(outFile)} · ${WIDTH}×${HEIGHT} · ${Math.round(size / 1024)} KB`);
console.log(
  `  escenario=${scenario} pista=${turntable.track ? turntable.track.title : '—'} letra=${
    turntable.lyricsStatus
  } lineas=${turntable.lyrics ? turntable.lyrics.lines.length : -1} disco=${turntable.discOut.toFixed(
    2,
  )} brazo=${turntable.armAngle.toFixed(3)} reloj=${turntable.clock.toFixed(2)}`,
);

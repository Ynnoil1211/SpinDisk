// Banco de física: mide las mecánicas del tocadiscos con el reloj falso.
//
// No dibuja nada para medir; sólo cuenta fotogramas. Al final escribe una tira
// de cuatro fotogramas del freno manual para revisar el gesto con los ojos.
//
//   node scripts/sim.mjs
//
// Sale con código 1 si alguna afirmación no se cumple.

import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FPS,
  STEP,
  StubBridge,
  build,
  clock,
  installDom,
  installFonts,
  loadScene,
  makeCanvas,
  makeTick,
  sleepMs,
} from './harness.mjs';

installFonts();
installDom({ offline: true });
build();

const { Scene, Turntable, DEFAULT_PREFERENCES, LAYOUT } = await loadScene();
const { ARM_ANGLE_AT_EDGE, ARM_ANGLE_AT_LABEL, armAngleForProgress, needlePoint, radiusForArmAngle, REST_ANGLE } =
  await import('../dist/scene/layout.js');

const RPM_33 = (33 / 60) * Math.PI * 2;
const COVER = path.resolve('docs/captures/_cover.jpg');

// ------------------------------------------------------------------ utilidades
const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(46, '.')} ${detail}`);
};

const seconds = (frames) => (frames / FPS).toFixed(2);

/** Diferencia de ángulos llevada a (−π, π], para medir vueltas sin saltos. */
const wrapDelta = (from, to) => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
};

const makeRig = () => {
  const bridge = new StubBridge();
  const turntable = new Turntable(bridge, { ...DEFAULT_PREFERENCES });
  const canvas = makeCanvas();
  const scene = new Scene(canvas, turntable);
  scene.resize();
  return { bridge, turntable, canvas, scene, tick: makeTick(turntable) };
};

const track = (title, overrides = {}) => ({
  title,
  artist: 'Banco de pruebas',
  album: 'Física',
  coverUrl: existsSync(COVER) ? COVER : undefined,
  currentTime: 0,
  duration: 245,
  isPlaying: true,
  canSeek: true,
  source: 'spotify',
  ...overrides,
});

/** Avanza hasta que `condition()` se cumpla; devuelve los fotogramas gastados. */
const tickUntil = (tick, condition, limit = 1200) => {
  for (let frame = 0; frame < limit; frame += 1) {
    tick(1);
    if (condition()) return frame + 1;
  }
  return -1;
};

/** Deja el disco fuera y la aguja apoyada, como al empezar una canción. */
const settleTrack = (rig, overrides = {}) => {
  rig.bridge.load(track('Uno', overrides));
  rig.tick(4);
  sleepMs(520);
  rig.tick(30);
  tickUntil(rig.tick, () => rig.turntable.discOut > 0.99 && rig.turntable.armLift < 0.02, 600);
  return rig;
};

// =============================================================== 1. arranque
console.log('\nPlato');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable } = rig;
  // El disco acaba de salir: medimos cuánto tarda el motor en ir a régimen.
  turntable.spin = 0;
  const frames = tickUntil(rig.tick, () => turntable.spin >= RPM_33 * 0.95, 300);
  check(
    'arranque hasta 95 % de 33⅓ RPM',
    frames > 0 && frames <= 60,
    `${seconds(frames)} s (objetivo ≤ 1,00 s)`,
  );
  check(
    'la aguja baja con el disco fuera',
    turntable.armLift < 0.05 && turntable.needleDown,
    `armLift ${turntable.armLift.toFixed(3)}`,
  );
  check(
    'el giro no se desborda',
    Number.isFinite(turntable.spinAngle) && Math.abs(turntable.spin) <= RPM_33 * 1.01,
    `ω ${turntable.spin.toFixed(2)} rad/s`,
  );
}

// ============================================================ 2. freno manual
console.log('\nFreno manual');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable, bridge } = rig;
  bridge.clear();

  turntable.pointerDown('disc', LAYOUT.disc.cx + 150, LAYOUT.disc.cy);
  check('el dedo manda pausa', bridge.calls.includes('pause'), bridge.calls.join(', ') || '—');

  const brakeFrames = tickUntil(rig.tick, () => turntable.spin <= RPM_33 * 0.05, 300);
  check(
    'frena en menos de 0,35 s',
    brakeFrames > 0 && brakeFrames <= 21,
    `${seconds(brakeFrames)} s`,
  );

  // Con el dedo encima el brazo no debe levantarse ni aparcar.
  rig.tick(FPS); // un segundo largo
  check(
    'la aguja sigue apoyada mientras frenas',
    turntable.armLift < 0.05 && turntable.scrubActive,
    `armLift ${turntable.armLift.toFixed(3)} · frenando ${turntable.scrubActive}`,
  );
  check(
    'el brazo no aparca con el dedo encima',
    Math.abs(turntable.armAngle - turntable.needleAngle) < 0.02,
    `Δ ${Math.abs(turntable.armAngle - turntable.needleAngle).toFixed(3)} rad`,
  );

  turntable.pointerUp();
  const resumeFrames = tickUntil(rig.tick, () => turntable.spin >= RPM_33 * 0.95, 300);
  check(
    'recupera el giro en medio segundo',
    resumeFrames > 0 && resumeFrames <= 42,
    `${seconds(resumeFrames)} s (objetivo ≤ 0,70 s)`,
  );
  check('al soltar vuelve a sonar', bridge.calls.includes('play'), bridge.calls.join(', '));
}

// ================================================== 3. la aguja sigue la música
console.log('\nGeometría del brazo');
{
  const radii = [0, 0.25, 0.5, 0.75, 1].map((progress) => {
    const angle = armAngleForProgress(progress);
    return { progress, angle, radius: radiusForArmAngle(angle) };
  });
  const ordered = radii.every((entry, index) => index === 0 || entry.angle > radii[index - 1].angle);
  check('el ángulo crece con el progreso', ordered, radii.map((r) => r.angle.toFixed(2)).join(' → '));
  check(
    'la púa nunca se sale del surco',
    radii.every(
      (entry) => entry.radius >= LAYOUT.arm.innerR - 1 && entry.radius <= LAYOUT.arm.outerR + 1,
    ),
    radii.map((r) => Math.round(r.radius)).join(' / ') + ' px',
  );

  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable } = rig;
  turntable.progress = 0.5 * turntable.duration;
  rig.tick(240);
  const expected = armAngleForProgress(0.5);
  check(
    'el brazo se posa en el segundo que suena',
    Math.abs(turntable.armAngle - expected) < 0.02,
    `Δ ${Math.abs(turntable.armAngle - expected).toFixed(3)} rad`,
  );
}

// ========================================================= 4. arrastre Premium
console.log('\nModo completo (Spotify Premium / YouTube)');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig, { canSeek: true, currentTime: 0 });
  const { turntable, bridge } = rig;
  bridge.clear();

  turntable.pointerDown('arm', LAYOUT.arm.px, LAYOUT.arm.py);
  // Hacia la galleta: el gesto de adelantar. El punto va un poco más allá del
  // límite a propósito, para comprobar que el tope está donde debe.
  const center = needlePoint(ARM_ANGLE_AT_LABEL + 0.25);
  turntable.pointerMove(center.x, center.y);
  const towardsCenter = Math.abs(turntable.armAngle - ARM_ANGLE_AT_LABEL);
  check(
    'arrastrar hacia el centro adelanta',
    towardsCenter < 0.05,
    `ángulo ${turntable.armAngle.toFixed(2)} vs galleta ${ARM_ANGLE_AT_LABEL.toFixed(2)}`,
  );

  // Y de vuelta al borde exterior.
  const edge = needlePoint(ARM_ANGLE_AT_EDGE - 0.25);
  turntable.pointerMove(edge.x, edge.y);
  const towardsEdge = Math.abs(turntable.armAngle - ARM_ANGLE_AT_EDGE);
  check(
    'arrastrar hacia el borde retrocede',
    towardsEdge < 0.05,
    `ángulo ${turntable.armAngle.toFixed(2)} vs borde ${ARM_ANGLE_AT_EDGE.toFixed(2)}`,
  );

  const middle = needlePoint(armAngleForProgress(0.6));
  turntable.pointerMove(middle.x, middle.y);
  turntable.pointerUp();
  const expectedSeconds = 0.6 * turntable.duration;
  const seeks = bridge.calls.filter((call) => call.startsWith('seek:'));
  check('soltar la aguja hace seek', seeks.length === 1, seeks.join(', ') || '—');
  check(
    'el segundo buscado coincide con la aguja',
    seeks.length === 1 && Math.abs(Number(seeks[0].slice(5)) - expectedSeconds) < 2,
    `${seeks[0] ?? '—'} · esperado ${expectedSeconds.toFixed(1)} s`,
  );
}

// ================================================== 5. el vinilo sigue al dedo
console.log('\nGiro con el dedo');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig, { canSeek: true, currentTime: 20 });
  const { turntable, bridge } = rig;
  turntable.progress = 20;
  rig.tick(4);
  bridge.clear();

  const { cx, cy } = LAYOUT.disc;
  const r = 170;

  // El dedo recorre el disco en el sentido del reloj (arriba → derecha → abajo).
  // En pantalla la Y crece hacia abajo, así que ese gesto aumenta el ángulo.
  turntable.pointerDown('disc', cx, cy - r);
  const startAngle = turntable.spinAngle;
  const startProgress = turntable.progress;
  turntable.pointerMove(cx + r, cy);
  turntable.pointerMove(cx, cy + r);

  const turned = wrapDelta(startAngle, turntable.spinAngle);
  check(
    'el vinilo gira hacia donde empuja el dedo',
    turned > Math.PI * 0.45,
    `${((turned * 180) / Math.PI).toFixed(1)}° en el sentido del reloj`,
  );
  check(
    'la música avanza con la mano',
    Math.abs(turntable.progress - startProgress - 7) < 0.25,
    `+${(turntable.progress - startProgress).toFixed(2)} s (media vuelta = 7 s)`,
  );

  // Hacia el otro lado: arrastrar en sentido antihorario (abajo → derecha)
  // tiene que girar el vinilo al revés y devolver segundos.
  const beforeBack = turntable.spinAngle;
  turntable.pointerMove(cx + r, cy);
  const backTurned = wrapDelta(beforeBack, turntable.spinAngle);
  check(
    'y al revés retrocede y gira al revés',
    backTurned < -Math.PI * 0.45 && Math.abs(turntable.progress - 23.5) < 0.25,
    `${((backTurned * 180) / Math.PI).toFixed(1)}° · ${turntable.progress.toFixed(1)} s`,
  );
  turntable.pointerUp();

  // Velocidad visible: una vuelta completa a régimen.
  const seeks = bridge.calls.filter((call) => call.startsWith('seek:'));
  check('soltar el disco devuelve el segundo al reproductor', seeks.length === 1, seeks.join(', ') || '—');
  rig.tick(150);
  let frames = 0;
  let swept = 0;
  let previous = turntable.spinAngle;
  while (frames < 900 && swept < Math.PI * 2) {
    rig.tick(1);
    frames += 1;
    swept += Math.abs(wrapDelta(previous, turntable.spinAngle));
    previous = turntable.spinAngle;
  }
  check(
    'una vuelta visible tarda unos cinco segundos',
    frames >= 280 && frames <= 330,
    `${seconds(frames)} s (giro físico: 1,80 s)`,
  );
}

// ============================================================== 6. modo Free
console.log('\nModo protegido (Spotify Free)');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig, { canSeek: false, currentTime: 52 });
  const { turntable, bridge } = rig;
  turntable.progress = 52;
  rig.tick(60);
  bridge.clear();
  const needle = turntable.needleAngle;

  turntable.pointerDown('arm', LAYOUT.arm.px, LAYOUT.arm.py);
  // Intentar volver atrás: hacia el borde exterior (ángulo menor).
  turntable.pointerMove(LAYOUT.arm.px - 10, LAYOUT.arm.py + 80);
  check(
    'no deja retroceder la aguja',
    turntable.armAngle >= needle - 0.006,
    `ángulo ${turntable.armAngle.toFixed(3)} vs música ${needle.toFixed(3)}`,
  );
  check(
    'la resistencia tiembla',
    turntable.armJitter > 0.5,
    `jitter ${turntable.armJitter.toFixed(2)}`,
  );

  turntable.pointerUp();
  rig.tick(40);
  check(
    'el brazo vuelve solo a su punto',
    Math.abs(turntable.armAngle - turntable.needleAngle) < 0.01,
    `Δ ${Math.abs(turntable.armAngle - turntable.needleAngle).toFixed(3)} rad`,
  );
  check('no hubo seek fantasma', !bridge.calls.some((c) => c.startsWith('seek:')), bridge.calls.join(', ') || '—');

  // Llevar la aguja hasta el final del disco: salto limpio a la siguiente.
  bridge.clear();
  turntable.pointerDown('arm', LAYOUT.arm.px, LAYOUT.arm.py);
  turntable.pointerMove(LAYOUT.disc.cx + 30, LAYOUT.disc.cy - 40);
  turntable.pointerUp();
  check('el final del disco salta a la siguiente', bridge.calls.includes('next'), bridge.calls.join(', '));
  check(
    'en Free la línea de tiempo está bloqueada',
    (() => {
      const before = turntable.progress;
      turntable.seekTo(before + 40);
      return Math.abs(turntable.progress - before) < 0.01;
    })(),
    'seek rechazado',
  );
}

// ======================================================= 6. antirrebote (burst)
console.log('\nCambio de disco sin colapso');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable, bridge } = rig;
  check('el primer disco sale', turntable.discOut > 0.99, turntable.discOut.toFixed(2));

  let lowest = 1;
  const titles = ['Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'];
  for (const [index, title] of titles.entries()) {
    sleepMs(110);
    rig.tick(Math.round((110 / 1000) * FPS));
    bridge.next(); // lo que haría el reproductor real al pulsar siguiente
    bridge.load(track(title, { duration: 200 + index * 13 }));
    lowest = Math.min(lowest, turntable.discOut);
  }
  check('el disco se guarda en la funda', lowest < 0.6, `mínimo ${lowest.toFixed(2)}`);

  const frames = tickUntil(rig.tick, () => turntable.discOut > 0.9, 240);
  const reveal = turntable.revealDelay;
  check(
    'espera 450 ms de calma antes de sacar el disco nuevo',
    frames > 0 && seconds(frames) >= 0.42,
    `${seconds(frames)} s (quedaban ${reveal.toFixed(0)} ms)`,
  );
  check(
    'sale el disco de la última canción',
    turntable.track?.title === 'Seis',
    turntable.track?.title ?? '—',
  );
  rig.tick(60);
  check(
    'la aguja baja sobre el disco nuevo',
    turntable.armLift < 0.1,
    `armLift ${turntable.armLift.toFixed(3)}`,
  );
}

// ========================================================== 6b. funda de cartón
console.log('\nFunda de cartón');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable } = rig;

  turntable.pointerDown('sleeve', LAYOUT.sleeve.cx, LAYOUT.sleeve.cy);
  check('tocar la carátula pide giro', turntable.flipTarget === 1, `objetivo ${turntable.flipTarget}`);

  let frames = 0;
  while (turntable.flip < 0.5 && frames < 120) {
    rig.tick(1);
    frames += 1;
  }
  const half = frames;
  while (turntable.flip < 0.995 && frames < 240) {
    rig.tick(1);
    frames += 1;
  }
  check(
    'pasa de canto hacia la mitad del giro',
    half > 8 && frames > 0 && Math.abs(half / frames - 0.5) < 0.18,
    `fotograma ${half} de ${frames}`,
  );
  check(
    'el giro tarda medio segundo',
    frames >= 26 && frames <= 40,
    `${seconds(frames)} s (${frames} fotogramas)`,
  );

  turntable.pointerDown('sleeve', LAYOUT.sleeve.cx, LAYOUT.sleeve.cy);
  tickUntil(rig.tick, () => turntable.flip < 0.005, 240);
  check(
    'volver a tocarla la devuelve al frente',
    turntable.flip < 0.005 && turntable.flipTarget === 0,
    `flip ${turntable.flip.toFixed(3)}`,
  );
}

// ============================================================ 7. reposo y reloj
console.log('\nReposo');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable, bridge } = rig;
  bridge.clear();
  turntable.togglePlay();
  check('pausa desde el panel', bridge.calls.includes('pause'), bridge.calls.join(', '));
  const wait = turntable.msUntilClock;
  check(
    'el panel sabe cuándo asoma el reloj',
    wait > 59_000 && wait <= 60_000,
    `${Math.round(wait / 1000)} s`,
  );

  const parkFrames = tickUntil(
    rig.tick,
    () => Math.abs(turntable.armAngle - REST_ANGLE) < 0.05,
    300,
  );
  const restRadius = radiusForArmAngle(REST_ANGLE);
  check(
    'el brazo viaja a su soporte',
    parkFrames > 0 && restRadius > LAYOUT.disc.r,
    `${seconds(parkFrames)} s · radio ${Math.round(restRadius)} px (disco ${LAYOUT.disc.r})`,
  );
  check(
    'la aguja queda levantada',
    turntable.armLift > 0.9,
    `armLift ${turntable.armLift.toFixed(2)}`,
  );

  sleepMs(61_000);
  rig.tick(6);
  const idleFrames = tickUntil(rig.tick, () => turntable.clock > 0.95, 240);
  check('a los 60 s entra el modo reloj', idleFrames > 0, `${seconds(idleFrames)} s`);  check(
    'el disco se guarda dejando asomar un tercio',
    Math.abs(turntable.discOut - 0.42) < 0.03,
    `discOut ${turntable.discOut.toFixed(2)}`,
  );
  rig.tick(180);
  check(
    'la escena queda quieta (un dibujo por minuto)',
    turntable.settled,
    turntable.settled ? 'settled' : 'aún animando',
  );

  bridge.clear();
  turntable.pointerDown('none', 10, 10);
  check(
    'un toque despierta y reanuda',
    turntable.clock < 0.5 && bridge.calls.includes('play'),
    bridge.calls.join(', '),
  );
  rig.tick(36);
  check('el disco vuelve al plato', turntable.discOut > 0.8, turntable.discOut.toFixed(2));
}

// ================================================== 7b. atajo del panel al reloj
console.log('\nAtajo al modo reloj');
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  const { turntable } = rig;

  const wait = turntable.msUntilClock;
  check(
    'sonando música el reloj no tiene hora',
    wait === Number.POSITIVE_INFINITY,
    Number.isFinite(wait) ? `${seconds(wait)} s` : 'sin cuenta atrás',
  );

  turntable.forceClock();
  const frames = tickUntil(rig.tick, () => turntable.clock > 0.95, 240);
  check('el atajo de F2 entra en modo reloj', frames > 0, `${seconds(frames)} s`);
  check(
    'y guarda el disco en la funda',
    Math.abs(turntable.discOut - 0.42) < 0.05,
    `discOut ${turntable.discOut.toFixed(2)}`,
  );

  turntable.togglePlay();
  const back = tickUntil(rig.tick, () => turntable.clock < 0.05, 240);
  check(
    'al reanudar la música el reloj se retira',
    back > 0 && turntable.playing,
    `${seconds(back)} s`,
  );
}

// ========================================================= tira del freno manual
{
  const rig = makeRig();
  await rig.turntable.connect();
  settleTrack(rig);
  // La portada se carga con un temporizador real: hay que ceder el turno una
  // vez para que llegue antes de fotografiar la escena.
  await new Promise((resolve) => setTimeout(resolve, 60));
  rig.tick(4);
  const { turntable, canvas, scene, tick } = rig;

  const tiles = [];
  const shoot = (caption) => {
    scene.render(clock.now);
    const copy = makeCanvas();
    copy.getContext('2d').drawImage(canvas, 0, 0);
    tiles.push({ caption, image: copy });
  };

  shoot('1 · el disco gira');
  turntable.pointerDown('disc', LAYOUT.disc.cx + 150, LAYOUT.disc.cy);
  tick(9);
  shoot('2 · el dedo frena el plato');
  tick(30);
  shoot('3 · el motor se detiene');
  turntable.pointerUp();
  tick(18);
  shoot('4 · al soltar vuelve el giro');

  const tileW = 640;
  const tileH = 400;
  const strip = makeCanvas(tileW * 2, tileH * 2);
  const ctx = strip.getContext('2d');
  ctx.fillStyle = '#100d0a';
  ctx.fillRect(0, 0, strip.width, strip.height);
  tiles.forEach((tile, index) => {
    const x = (index % 2) * tileW;
    const y = Math.floor(index / 2) * tileH;
    ctx.drawImage(tile.image, x, y, tileW, tileH);
    ctx.font = '15px "Segoe UI"';
    const label = ctx.measureText(tile.caption).width;
    ctx.fillStyle = 'rgba(20,16,12,0.62)';
    ctx.fillRect(x + 18, y + tileH - 46, label + 34, 30);
    ctx.fillStyle = '#f2e9d8';
    ctx.fillText(tile.caption, x + 34, y + tileH - 25);
  });

  const outFile = path.resolve('docs/captures/f2-freno.png');
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, strip.toBuffer('image/png'));
  const kb = Math.round(statSync(outFile).size / 1024);
  console.log(`\n  tira de fotogramas → docs/captures/f2-freno.png (${kb} KB)`);
}

// ====================================================================== informe
const failures = results.filter((entry) => !entry.ok);
console.log(
  `\n${failures.length === 0 ? '✓' : '✗'} ${results.length - failures.length}/${
    results.length
  } comprobaciones · ${STEP.toFixed(2)} ms por fotograma · reloj ${(clock.now / 1000).toFixed(1)} s`,
);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  falló: ${failure.label} (${failure.detail})`);
  process.exit(1);
}

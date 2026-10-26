// Banco del motor Foley: comprueba el grafo de WebAudio con un AudioContext falso.
//
// No se puede oír nada en esta máquina (ni hay navegador ni tarjeta de sonido),
// así que se afirma con números lo que el oído debería notar: qué forma de onda
// cae, cuánto dura, cuánto sube y cómo de lejos queda de la voz de la canción.
//
//   node scripts/audiotest.mjs
//
// Sale con código 1 si alguna afirmación no se cumple.

import { StubBridge, build, installDom, loadScene, makeTick, sleepMs } from './harness.mjs';
import { audio, installAudio } from './fakeaudio.mjs';

installDom({ offline: true });
installAudio();
build();

const { Foley } = await import('../dist/audio/foley.js');
const { Turntable, DEFAULT_PREFERENCES } = await loadScene();

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(48, '.')} ${detail}`);
};
const group = (title) => console.log(`\n${title}`);

/** Un motor nuevo, ya desbloqueado, para no arrastrar nodos de la prueba previa. */
const freshFoley = (volume) => {
  audio.reset();
  const foley = new Foley();
  if (volume !== undefined) foley.setVolume(volume);
  return foley;
};

const ctxOf = () => audio.last;
const nodesOf = (kind) => ctxOf().of(kind);
const peak = (buffer) => {
  const data = buffer.getChannelData(0);
  let max = 0;
  for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
  return max;
};
const round = (value, decimals = 2) => Number(value.toFixed(decimals));

// ============================================================ 1. antes del gesto
group('Antes del primer gesto');
{
  const foley = freshFoley();
  check('el motor arranca apagado', foley.ready === false, `ready=${foley.ready}`);

  let threw = false;
  try {
    foley.crackle(true);
    foley.needleDrop();
    foley.switchClick(true);
    foley.armTouch();
  } catch {
    threw = true;
  }
  check('pedir sonido sin contexto no rompe ni crea audio', !threw && audio.contexts.length === 0, `contextos=${audio.contexts.length}`);
}

// ================================================================ 2. encendido
group('Encendido en el primer toque');
{
  const foley = freshFoley();
  foley.unlock();
  const ctx = ctxOf();
  const master = nodesOf('gain')[0];
  check('crea un contexto y un mezclador', Boolean(ctx) && Boolean(master), `nodos=${ctx.nodes.length}`);
  check('el mezclador llega al altavoz', master.reachesDestination(), `salidas=${master.outputs.length}`);
  check('volumen inicial 55 % × techo 0,4', round(master.gain.value) === 0.22, `${round(master.gain.value)}`);
  check('el contexto queda en marcha', ctx.state === 'running' && ctx.resumed === 1, `${ctx.state} · resume=${ctx.resumed}`);

  foley.unlock();
  check('un segundo toque no duplica el contexto', audio.contexts.length === 1, `contextos=${audio.contexts.length}`);
}

// ================================================================== 3. niveles
group('Niveles: el Foley nunca tapa la voz');
{
  const foley = freshFoley();
  foley.unlock();
  const master = () => nodesOf('gain')[0].gain;

  foley.setVolume(1);
  check('al 100 % el techo es 0,4', round(master().destination) === 0.4, `${round(master().destination)}`);
  foley.setVolume(0.5);
  check('al 50 % baja a 0,2', round(master().destination) === 0.2, `${round(master().destination)}`);
  foley.setVolume(0);
  check('a 0 es silencio absoluto', master().destination === 0, `${master().destination}`);
  foley.setVolume(4);
  check('pedir de más se recorta al techo', round(master().destination) === 0.4, `${round(master().destination)}`);
  foley.setVolume(-2);
  check('pedir de menos se recorta a cero', master().destination === 0, `${master().destination}`);
  check(
    'estática y aguja a la vez siguen bajo 0,5',
    round(0.4 * (0.5 + 0.55)) < 0.5,
    `${round(0.4 * (0.5 + 0.55))} de pico teórico`,
  );
  foley.setVolume(0.55);
}

// ============================================================== 4. chisporroteo
group('Chisporroteo de polvo');
{
  const foley = freshFoley();
  foley.unlock();
  foley.crackle(true);
  const sources = nodesOf('source');
  const source = sources[0];
  check('crea una sola fuente en bucle', sources.length === 1 && source.loop === true, `fuentes=${sources.length} · loop=${source.loop}`);
  check('el bucle dura cuatro segundos', source.buffer.length === 176_400, `${source.buffer.length} muestras`);
  check('el bucle no está en silencio', round(peak(source.buffer)) > 0.3, `pico ${round(peak(source.buffer))}`);
  check('y está normalizado, sin recortar por sí mismo', peak(source.buffer) <= 0.95, `pico ${round(peak(source.buffer))}`);

  const highpass = source.outputs[0];
  const lowpass = highpass?.outputs[0];
  const gain = lowpass?.outputs[0];
  check(
    'pasa por paso alto 420 y paso bajo 5.200',
    highpass?.type === 'highpass' && round(highpass.frequency.value) === 420 && lowpass?.type === 'lowpass' && round(lowpass.frequency.value) === 5200,
    `${highpass?.type} ${round(highpass?.frequency.value)} · ${lowpass?.type} ${round(lowpass?.frequency.value)}`,
  );
  check('entra subiendo en un tercio de segundo', gain?.gain.destination === 0.5 && round(gain.gain.last.tau) === 0.35, `destino ${gain?.gain.destination} · tau ${round(gain?.gain.last.tau)}`);

  foley.crackle(true);
  check('encender dos veces no duplica la fuente', nodesOf('source').length === 1, `fuentes=${nodesOf('source').length}`);

  foley.crackle(false);
  check('levantar la aguja lo apaga', gain.gain.destination === 0, `destino ${gain.gain.destination}`);
  check('y no deja cola: se apaga en medio segundo', gain.gain.last.tau === 0.18, `tau ${gain.gain.last.tau} s`);

  foley.crackle(true);
  foley.setEnabled(false);
  check('el interruptor general también lo silencia', gain.gain.destination === 0, `destino ${gain.gain.destination}`);
  foley.setEnabled(true);
  check('y al volver deja el nivel de antes', gain.gain.destination === 0.5, `destino ${gain.gain.destination}`);
}

// ============================================================ 5. caída de aguja
group('Caída de aguja');
{
  const foley = freshFoley();
  foley.unlock();
  foley.needleDrop();
  const osc = nodesOf('oscillator')[0];
  const envelope = osc.outputs[0];
  check('es un seno grave', osc.type === 'sine', `${osc.type}`);
  check('ataca en 96 Hz y cae a 44 Hz', Math.round(osc.frequency.events[0].value) === 96 && Math.round(osc.frequency.events[1].value) === 44, `${osc.frequency.events[0].value} → ${osc.frequency.events[1].value} Hz`);
  check('la caída dura 0,18 s', round(osc.frequency.events[1].time) === 0.18, `${round(osc.frequency.events[1].time)} s`);
  check('golpea a 0,55 y muere en 0,34 s', round(envelope.gain.events[1].value) === 0.55 && round(envelope.gain.events[2].time) === 0.34, `${round(envelope.gain.events[1].value)} · ${round(envelope.gain.events[2].time)} s`);
  check('suena 0,4 s y se apaga', round(osc.stopped) === 0.4 && osc.started === 0, `start ${osc.started} · stop ${osc.stopped}`);
  const burst = nodesOf('source')[0];
  check('y trae un golpe de ruido de contacto', burst?.buffer.length === Math.floor(44_100 * 0.035), `${burst?.buffer.length} muestras`);
  check('el ruido es de banda 900 Hz', round(burst.outputs[0].frequency.value) === 900, `${burst?.outputs[0]?.frequency.value} Hz`);
}

// =============================================================== 6. interruptor
group('Interruptor del motor');
{
  const foley = freshFoley();
  foley.unlock();
  foley.switchClick(true);
  const on = nodesOf('oscillator')[0];
  check('arrancar es un triángulo de 180 a 70 Hz', on.type === 'triangle' && Math.round(on.frequency.events[0].value) === 180 && Math.round(on.frequency.events[1].value) === 70, `${on.type} ${on.frequency.events[0].value} → ${on.frequency.events[1].value}`);
  check('el click dura 0,16 s', round(on.stopped) === 0.16, `${round(on.stopped)} s`);
  check('y pica a 0,22', round(on.outputs[0].gain.events[1].value) === 0.22, `${round(on.outputs[0].gain.events[1].value)}`);

  foley.switchClick(false);
  const off = nodesOf('oscillator')[1];
  check('frenar desciende de 140 a 58 Hz', Math.round(off.frequency.events[0].value) === 140 && Math.round(off.frequency.events[1].value) === 58, `${off.frequency.events[0].value} → ${off.frequency.events[1].value}`);

  foley.armTouch();
  const touch = nodesOf('source').at(-1);
  check('el roce del brazo es de banda 1.500 Hz', round(touch.outputs[0].frequency.value) === 1500, `${round(touch.outputs[0].frequency.value)} Hz`);
  check('y es apenas audible: 0,045', touch.outputs[0].outputs[0].gain.events[1].value === 0.045, `${touch.outputs[0].outputs[0].gain.events[1].value}`);
}

// ================================================== 7. integración con el plato
group('El plato dispara el Foley');
{
  audio.reset();
  const bridge = new StubBridge();
  const turntable = new Turntable(bridge, { ...DEFAULT_PREFERENCES });
  const tick = makeTick(turntable);
  await turntable.connect();
  turntable.foley.unlock();
  const ctx = ctxOf();

  bridge.load({
    title: 'Ruido de fondo',
    artist: 'Banco de pruebas',
    album: 'Foley',
    currentTime: 0,
    duration: 245,
    isPlaying: true,
    canSeek: true,
    source: 'spotify',
  });
  tick(4);
  sleepMs(520);
  for (let frame = 0; frame < 600 && !(turntable.discOut > 0.99 && turntable.armLift < 0.02); frame += 1) tick(1);

  const drops = ctx.of('oscillator').filter((node) => node.type === 'sine' && Math.round(node.frequency.events[0]?.value) === 96);
  const crackleSource = ctx.of('source').find((node) => node.loop === true);
  const crackleGain = crackleSource?.outputs[0]?.outputs[0]?.outputs[0];
  check('al posarse la aguja suena una caída', drops.length === 1, `caídas=${drops.length}`);
  check('la estática queda encendida', crackleGain?.gain.destination === 0.5, `destino ${crackleGain?.gain.destination}`);

  const before = drops.length;
  tick(40);
  check('no repite la caída en cada fotograma', ctx.of('oscillator').filter((node) => node.type === 'sine' && Math.round(node.frequency.events[0]?.value) === 96).length === before, `caídas=${before}`);

  turntable.pointerDown('disc', 800, 414);
  const clicks = ctx.of('oscillator').filter((node) => node.type === 'triangle');
  check('frenar con el dedo hace click de motor', clicks.length >= 1, `clicks=${clicks.length}`);
  check('y la aguja deja de chisporrotear', crackleGain.gain.destination === 0, `destino ${crackleGain.gain.destination}`);

  turntable.pointerUp();
  for (let frame = 0; frame < 300; frame += 1) tick(1);
  check('al soltar vuelve el chisporroteo', crackleGain.gain.destination === 0.5, `destino ${crackleGain.gain.destination}`);
}

// ==================================================================== resumen
const failed = results.filter((item) => !item.ok);
console.log(`\n${failed.length === 0 ? '✓' : '✗'} ${results.length - failed.length}/${results.length} comprobaciones · motor Foley`);
if (failed.length > 0) process.exit(1);

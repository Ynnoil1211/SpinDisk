/**
 * Banco de pruebas de la consola de control (F3) sin navegador.
 *
 * Construye el DOM desde el `index.html` real y ejecuta el código real de
 * `src/ui/panel.ts`. Comprueba lo que se puede comprobar sin ojos: que los
 * elementos existan, que el temporizador de 3 s se reinicie al tocar, que la
 * línea de tiempo se bloquee en Free, que las texturas y el RPM persistan, y
 * que el toque largo del puente abra la ventana flotante.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { installDom } from './minidom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const { document, body, clock } = installDom(html);

const { ConsolePanel } = await import('../dist/ui/panel.js');

let failures = 0;
let checks = 0;

function check(label, ok, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  ✓ ${label}${detail ? `................ ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` · ${detail}` : ''}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// --- Turntable de mentira: expone lo que la consola lee y anota lo que pide.
function makeTurntable() {
  return {
    progress: 42,
    duration: 245,
    playing: true,
    canSeek: true,
    clock: 0,
    track: { source: 'spotify' },
    calls: [],
    previous() {
      this.calls.push('previous');
    },
    next() {
      this.calls.push('next');
    },
    togglePlay() {
      this.playing = !this.playing;
      this.calls.push('togglePlay');
    },
    seekTo(seconds) {
      this.calls.push(`seek:${seconds.toFixed(2)}`);
    },
    openSource(floating) {
      this.calls.push(`source:${floating ? 'floating' : 'tap'}`);
    },
  };
}

const prefs = { discTexture: 'marble', rpm: 33, foley: 0.55, clockWhilePlaying: false };
const notices = [];
const prefEvents = [];
const turntable = makeTurntable();

const panel = new ConsolePanel(document.getElementById('console'), turntable, prefs, {
  onPreferences(next) {
    prefEvents.push({ ...next });
  },
  notify(message) {
    notices.push(message);
  },
});

const el = (id) => document.getElementById(id);
const bodyClass = (name) => body.classList.contains(name);

// ---------------------------------------------------------------- construcción
group('Construcción y cableado');
check('la consola encuentra todos sus elementos', panel instanceof ConsolePanel);
check('arranca cerrada', panel.isOpen === false);
check('arranca con aria-hidden', el('console').getAttribute('aria-hidden') === 'true');

const text = el('t-now').textContent;
check('el tiempo se pinta al construir', text === '0:42', `t-now = ${text}`);
const left = el('t-left').textContent;
check('el restante se pinta al construir', left === '-3:23', `t-left = ${left}`);
const fill = el('track-fill').style.width ?? '';
check('la barra se llena al 17 %', fill.startsWith('17.1'), `width = ${fill}`);
check('el estado dice que suena', el('t-state').textContent === 'escuchando');
check('el cuerpo lleva is-playing', bodyClass('is-playing'));

// ------------------------------------------------------------------ abrir/cerrar
group('Aparición y ocultación a los 3 s');
panel.open();
check('abre con is-open', el('console').classList.contains('is-open'));
check('marca el cuerpo con has-panel', bodyClass('has-panel'));
clock.advance(2900);
check('sigue abierta a los 2,9 s', panel.isOpen === true);
clock.advance(200);
check('se cierra sola a los 3,1 s', panel.isOpen === false);
check('al cerrarse limpia has-panel', bodyClass('has-panel') === false);

panel.open();
clock.advance(2000);
panel.arm();
clock.advance(2000);
check('tocar reinicia la cuenta atrás', panel.isOpen === true, 'abierta a los 4 s');
clock.advance(1100);
check('y se cierra 3 s después del último toque', panel.isOpen === false);

panel.open();
el('console').dispatch('pointermove');
clock.advance(2500);
el('console').dispatch('pointermove');
clock.advance(2500);
check('mover el dedo por el panel también la mantiene', panel.isOpen === true);
panel.close();

// -------------------------------------------------------------------- transporte
group('Transporte');
el('btn-next').dispatch('click');
el('btn-prev').dispatch('click');
el('btn-play').dispatch('click');
check('siguiente, anterior y play llegan al tocadiscos', turntable.calls.join(',') === 'next,previous,togglePlay', turntable.calls.join(','));
check('el icono de pausa aparece al sonar', bodyClass('is-playing') === false, 'togglePlay dejó playing=false');

// --------------------------------------------------------------- línea de tiempo
group('Línea de tiempo');
turntable.canSeek = true;
turntable.playing = true;
panel.refresh();
const slider = el('timeline');
slider.value = '500';
slider.dispatch('input');
check('arrastrar pinta el pulgar al 50 %', (el('track-knob').style.left ?? '').startsWith('50.0'));
slider.dispatch('change');
check('soltar pide el segundo exacto', turntable.calls.at(-1) === 'seek:122.50', turntable.calls.at(-1));

turntable.canSeek = false;
panel.refresh();
check('en Free el módulo se marca bloqueado', el('timeline').closest('.module').classList.contains('is-locked'));
check('en Free el control queda aria-disabled', slider.getAttribute('aria-disabled') === 'true');
check('en Free el estado lo dice', el('t-state').textContent === 'Free · sin retroceso');
slider.value = '900';
slider.dispatch('input');
check('en Free el pulgar no se mueve', (el('track-knob').style.left ?? '').startsWith('17.1'), `left = ${el('track-knob').style.left}`);
const seeksBefore = turntable.calls.filter((call) => call.startsWith('seek:')).length;
slider.dispatch('change');
const seeksAfter = turntable.calls.filter((call) => call.startsWith('seek:')).length;
check('en Free soltar no dispara ninguna búsqueda', seeksBefore === seeksAfter, `${seeksBefore} → ${seeksAfter}`);

turntable.canSeek = true;
turntable.playing = false;
turntable.clock = 0;
panel.refresh();
check('en pausa el estado dice "en pausa"', el('t-state').textContent === 'en pausa');
turntable.clock = 0.9;
panel.refresh();
check('en reposo el estado dice "reposo"', el('t-state').textContent === 'reposo');
check('el cuerpo lleva is-sleeping', bodyClass('is-sleeping'));
turntable.clock = 0;
turntable.playing = true;
panel.refresh();

// -------------------------------------------------------------------- texturas
group('Texturas del vinilo');
const swatch = document.querySelector('[data-texture="glass"]');
swatch.dispatch('click');
check('elegir cristal cambia la preferencia', prefs.discTexture === 'glass');
check('la preferencia se propaga al motor', prefEvents.at(-1)?.discTexture === 'glass');
check('el aviso nombra la textura', (notices.at(-1) ?? '').startsWith('Textura:'), notices.at(-1));
check('el anillo activo se mueve', swatch.classList.contains('is-active') && !document.querySelector('[data-texture="marble"]').classList.contains('is-active'));

// ------------------------------------------------------------------------ RPM
group('Velocidad');
const rpm45 = document.querySelector('#rpm-switch [data-rpm="45"]');
rpm45.dispatch('click');
check('45 RPM cambia la preferencia', prefs.rpm === 45);
check('el aviso aclara que sólo cambia el giro', (notices.at(-1) ?? '').includes('45 RPM'), notices.at(-1));
check('el interruptor marca 45', rpm45.classList.contains('is-active'));
document.querySelector('#rpm-switch [data-rpm="33"]').dispatch('click');
check('volver a 33⅓ funciona', prefs.rpm === 33);

// ---------------------------------------------------------------------- aguja
group('Mezclador de aguja');
const foley = el('foley');
foley.value = '30';
foley.dispatch('input');
check('el deslizador mueve el volumen', Math.abs(prefs.foley - 0.3) < 1e-6, String(prefs.foley));
check('el volumen llega al motor', Math.abs((prefEvents.at(-1)?.foley ?? -1) - 0.3) < 1e-6);
check('cambiar el volumen no obliga a redibujar el panel', el('t-state').textContent === 'escuchando');
foley.dispatch('change');
check('soltar el deslizador no rompe nada', premio(() => panel.refresh()));

// ------------------------------------------------------------------ reloj de día
group('Reloj mientras suena');
const clockOn = document.querySelector('#clock-switch [data-clock="on"]');
const clockOff = document.querySelector('#clock-switch [data-clock="off"]');
check('el módulo del reloj existe', Boolean(clockOn && clockOff));
check('arranca apagado', clockOff.classList.contains('is-active') && !prefs.clockWhilePlaying);
clockOn.dispatch('click');
check('encenderlo cambia la preferencia', prefs.clockWhilePlaying === true);
check('y el motor lo recibe', prefEvents.at(-1)?.clockWhilePlaying === true);
check('el aviso explica qué va a pasar', (notices.at(-1) ?? '').includes('Reloj'), notices.at(-1));
check('el interruptor se mueve', clockOn.classList.contains('is-active') && !clockOff.classList.contains('is-active'));
clockOff.dispatch('click');
check('apagarlo vuelve atrás', prefs.clockWhilePlaying === false);

// ---------------------------------------------------------------- puente a la app
group('Puente a la app activa');
const source = el('source');
source.dispatch('pointerdown');
clock.advance(300);
source.dispatch('pointerup');
check('un toque simple abre la app', turntable.calls.at(-1) === 'source:tap', turntable.calls.at(-1));

turntable.calls = [];
source.dispatch('pointerdown');
clock.advance(520);
check('mantener 520 ms abre la ventana flotante', turntable.calls.at(-1) === 'source:floating', turntable.calls.join(','));
check('y avisa de lo que va a hacer', (notices.at(-1) ?? '').includes('ventana flotante'), notices.at(-1));
source.dispatch('pointerup');
check('soltar después no vuelve a abrir', turntable.calls.filter((c) => c.startsWith('source:')).length === 1, turntable.calls.join(','));

// ------------------------------------------------------------------- preferencias
group('Preferencias persistentes');
check('cada cambio entrega el objeto completo', prefEvents.every((p) => 'discTexture' in p && 'rpm' in p && 'foley' in p && 'clockWhilePlaying' in p));

function premio(fn) {
  try {
    fn();
    return true;
  } catch (error) {
    console.log(`    ⚠ ${error.message}`);
    return false;
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${checks - failures}/${checks} comprobaciones de la consola`);

// ===========================================================================
// Panel F2: el "falso Android". Se prueba con una búsqueda de iTunes simulada.
// ===========================================================================

const { mountSandbox } = await import('../dist/ui/sandbox.js');

const itunes = {
  results: [
    {
      trackId: 1,
      kind: 'song',
      trackName: 'Derrotado En El Dolor',
      artistName: 'Kaleth Morales',
      collectionName: 'Cambia El Mundo',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg',
      trackTimeMillis: 245000,
    },
    {
      trackId: 2,
      kind: 'song',
      trackName: 'La Creciente',
      artistName: 'Los Hermanos Zuleta',
      collectionName: 'Poncho Zurullo',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/y/100x100bb.jpg',
      trackTimeMillis: 231000,
    },
  ],
};
let fetchCount = 0;
globalThis.fetch = async (url) => {
  fetchCount += 1;
  if (String(url).includes('itunes')) {
    return { ok: true, status: 200, json: async () => itunes };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const fakeBridge = {
  state: { track: null, playing: false, canSeek: true, currentTime: 0, duration: 0 },
  calls: [],
  setCanSeek(value) {
    this.state.canSeek = value;
    this.calls.push(`canSeek:${value}`);
  },
  burst(count) {
    this.calls.push(`burst:${count}`);
  },
  setQueue(list, index) {
    this.calls.push(`queue:${list.length}@${index}`);
  },
  async load(track) {
    this.calls.push(`load:${track.title}`);
    this.state.track = track;
    this.state.playing = true;
  },
};

const sandboxNotices = [];
const sandboxCalls = [];
const sandbox = mountSandbox(
  fakeBridge,
  (message) => sandboxNotices.push(message),
  {
    forceClock: () => sandboxCalls.push('clock'),
    clockIn: () => 42_400,
  },
);
const flushed = () => new Promise((resolve) => setImmediate(resolve));

group('Panel F2 · búsqueda real simulada');
const sandboxRoot = document.getElementById('sandbox');
check('el panel se construye desde la plantilla', sandboxRoot.querySelectorAll('.sandbox__row').length === 3);
check('arranca oculto', sandbox.isOpen === false && sandboxRoot.hidden === true);

sandbox.open();
check('F2 lo abre y enfoca el buscador', sandbox.isOpen === true && sandboxRoot.hidden === false);
check('el campo recibe el foco', document.activeElement === sandboxRoot.querySelector('.sandbox__term'));

const term = sandboxRoot.querySelector('.sandbox__term');
term.value = 'kaleth';
term.dispatch('input');
clock.advance(300);
check('no busca antes de 420 ms', fetchCount === 0, `${fetchCount} consultas`);
clock.advance(200);
await flushed();
check('busca al pasar el retardo', fetchCount === 1, `${fetchCount} consulta`);
const results = sandboxRoot.querySelectorAll('.result');
check('pinta un resultado por canción', results.length === 2, `${results.length} resultados`);
check('el resultado trae portada', String(results[0].querySelector('img')?.src).includes('600x600bb'));
check('y el título real', results[0].querySelector('strong')?.textContent === 'Derrotado En El Dolor');
check('y el artista con el álbum', results[0].querySelector('small')?.textContent === 'Kaleth Morales · Cambia El Mundo');

results[0].dispatch('click');
await flushed();
check('elegir un resultado lo pone a sonar', fakeBridge.calls.includes('load:Derrotado En El Dolor'), fakeBridge.calls.join(','));
check('la búsqueda se convierte en cola', fakeBridge.calls.includes('queue:2@0'), fakeBridge.calls.join(','));
check('los resultados se limpian al elegir', sandboxRoot.querySelectorAll('.result').length === 0);
check('y avisa qué suena', (sandboxNotices.at(-1) ?? '').startsWith('Sonando'), sandboxNotices.at(-1));

group('Panel F2 · cuenta y casos extremos');
sandboxRoot.querySelector('[data-free]').dispatch('click');
check('el interruptor Free llega al puente', fakeBridge.calls.at(-1) === 'canSeek:false', fakeBridge.calls.at(-1));
check('el aviso explica la resistencia', (sandboxNotices.at(-1) ?? '').includes('resiste'), sandboxNotices.at(-1));
check('Premium pierde el anillo activo', !sandboxRoot.querySelector('[data-premium]').classList.contains('is-active'));

fakeBridge.calls = [];
sandboxRoot.querySelector('[data-burst]').dispatch('click');
check('con algo sonando simula los 5 saltos', fakeBridge.calls.join(',') === 'burst:5', fakeBridge.calls.join(','));
check('y avisa de que el disco espera dentro', (sandboxNotices.at(-1) ?? '').includes('dentro de la funda'), sandboxNotices.at(-1));

sandbox.sync();
check('la línea de estado nombra la pista', (sandboxRoot.querySelector('[data-now]').textContent ?? '').includes('Derrotado En El Dolor'));

// El reloj es lo único que no se puede esperar sentado: el panel lo adelanta.
// La app sólo promete una cuenta atrás cuando no hay música, así que el caso se
// pone en pausa antes de leer el aviso.
fakeBridge.state.playing = false;
sandbox.sync();
check(
  'el panel anuncia cuándo asoma el reloj',
  (sandboxRoot.querySelector('[data-clock-hint]').textContent ?? '').includes('43'),
  sandboxRoot.querySelector('[data-clock-hint]').textContent,
);
sandboxRoot.querySelector('[data-clock]').dispatch('click');
check('el botón de reloj llega al tocadiscos', sandboxCalls.join(',') === 'clock', sandboxCalls.join(','));
check('y avisa de lo que va a pasar', (sandboxNotices.at(-1) ?? '').includes('Modo reloj'), sandboxNotices.at(-1));

sandbox.close();
check('se cierra y oculta', sandbox.isOpen === false && sandboxRoot.hidden === true);

// ------------------------------------------------------------------ aviso con acción

group('Aviso del permiso de notificaciones');

const { Banner } = await import('../dist/ui/banner.js');
const bannerRoot = document.getElementById('banner');
const bannerCalls = [];
const banner = new Banner(bannerRoot, { onAction: () => bannerCalls.push('settings') });

check('el aviso se construye desde el documento', bannerRoot !== null && bannerRoot.querySelector('[data-banner-text]') !== null);
check('arranca oculto', banner.isVisible === false && bannerRoot.hidden === true);

banner.show('Activa el acceso a las notificaciones');
check('al pedirlo se muestra', banner.isVisible === true && bannerRoot.classList.contains('is-visible'));
check('sin el atributo hidden', bannerRoot.hidden === false);
check(
  'con el texto del permiso',
  (bannerRoot.querySelector('[data-banner-text]').textContent ?? '').includes('notificaciones'),
  bannerRoot.querySelector('[data-banner-text]').textContent,
);

bannerRoot.querySelector('[data-banner-action]').dispatch('click');
check('el botón abre los ajustes', bannerCalls.join(',') === 'settings', bannerCalls.join(','));
check('y el aviso se retira solo', banner.isVisible === false && bannerRoot.hidden === true);

console.log(`\n${failures === 0 ? '✓' : '✗'} ${checks - failures}/${checks} comprobaciones · consola, panel F2 y aviso`);
process.exit(failures === 0 ? 0 : 1);

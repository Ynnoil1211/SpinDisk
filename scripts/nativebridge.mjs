// `npm run bridge` — prueba el puente nativo con un Android de mentira.
//
// El Kotlin no se puede compilar aquí, pero su mitad JavaScript sí se puede
// ejercitar: se instala un `window.SpinDiskNative` que imita al `NativeBridge.kt`
// (mismos nombres y mismos valores de vuelta) y se comprueba que el puente
// traduce bien, que los comandos llegan y que la escena reacciona a lo que
// empuja la capa nativa.
import { build, clock, installDom, loadScene, makeTick } from './harness.mjs';

installDom();
build();

const { isNativeShell, parseSnapshot, AndroidBridge, NATIVE_NOTICE } = await import(
  '../dist/bridge/android.js'
);
const { Turntable, DEFAULT_PREFERENCES } = await loadScene();

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? '✓' : '✗';
  const pad = '.'.repeat(Math.max(2, 54 - label.length));
  console.log(`  ${mark} ${label}${pad} ${detail}`);
};

const title = 'Derrotado En El Dolor';
const payload = (extra = {}) =>
  JSON.stringify({
    id: `${title}|Kaleth Morales|Cambia El Mundo`,
    title,
    artist: 'Kaleth Morales',
    album: 'Cambia El Mundo',
    coverUrl: null,
    currentTime: 42.4,
    duration: 245,
    isPlaying: true,
    canSeek: false,
    source: 'spotify',
    ...extra,
  });

/** Doble del `NativeBridge.kt`. */
const native = {
  calls: [],
  acceptsSeek: false,
  current: payload(),
  platform: () => 'android',
  start() {
    native.calls.push('start');
    return true;
  },
  snapshot: () => native.current,
  listening: () => true,
  play() {
    native.calls.push('play');
    return true;
  },
  pause() {
    native.calls.push('pause');
    return true;
  },
  next() {
    native.calls.push('next');
    return true;
  },
  previous() {
    native.calls.push('previous');
    return true;
  },
  seek(seconds) {
    native.calls.push(`seek:${seconds.toFixed(2)}`);
    return native.acceptsSeek;
  },
  openSource(floating) {
    native.calls.push(`source:${floating ? 'floating' : 'tap'}`);
  },
  notificationAccess: () => true,
  openNotificationSettings() {
    native.calls.push('settings');
  },
};

window.SpinDiskNative = native;

console.log('\nPuente nativo');
check('se reconoce la tablet por el puente', isNativeShell(), 'SpinDiskNative.platform()');

const bridge = new AndroidBridge();
const seen = [];
bridge.subscribe((snapshot) => seen.push(snapshot));

await bridge.connect();
check('connect() arranca el servicio nativo', native.calls.includes('start'), 'start()');
check('la primera instantánea llega sin esperar', seen.length === 1, `${seen.length} recibida(s)`);
check('traduce título y artista', seen[0]?.title === title && seen[0]?.artist === 'Kaleth Morales', seen[0]?.artist ?? '—');
check('traduce el segundo exacto', seen[0]?.currentTime === 42.4, `${seen[0]?.currentTime} s`);
check('traduce la duración', seen[0]?.duration === 245, `${seen[0]?.duration} s`);
check('traduce la fuente', seen[0]?.source === 'spotify', seen[0]?.source ?? '—');
check('Spotify Free llega como canSeek=false', seen[0]?.canSeek === false, 'false');

// --- comandos ---------------------------------------------------------------
native.calls.length = 0;
await bridge.play();
await bridge.pause();
await bridge.next();
await bridge.previous();
bridge.openSource({ floating: true });
bridge.openSource(true);
check(
  'los comandos llegan al sistema en orden',
  native.calls.join(',') === 'play,pause,next,previous,source:floating,source:floating',
  native.calls.join(','),
);

native.calls.length = 0;
const refused = await bridge.seek(120);
check('con Free el seek se rechaza', refused === false, 'false');
check('pero el segundo sí viaja al sistema', native.calls[0] === 'seek:120.00', native.calls[0] ?? '—');

native.acceptsSeek = true;
const accepted = await bridge.seek(147.5);
check('con Premium el seek se acepta', accepted === true, 'true');

// --- lo que empuja Kotlin --------------------------------------------------
native.current = payload({ title: 'Seis', currentTime: 3.2, canSeek: true });
window.__spindisk.onSnapshot(native.current);
check('una instantánea nueva avisa al suscriptor', seen.at(-1)?.title === 'Seis', seen.at(-1)?.title ?? '—');
check('y trae la capacidad nueva', seen.at(-1)?.canSeek === true, 'true');

window.__spindisk.onSnapshot('');
check('sin reproductor la instantánea es nula', seen.at(-1) === null, 'null');

const before = seen.length;
window.__spindisk.onSnapshot('{ esto no es json');
check('un JSON roto no rompe nada', seen.at(-1) === null && seen.length === before + 1, 'null');

let notice = '';
window.addEventListener(NATIVE_NOTICE, (event) => {
  notice = event.detail;
});
window.__spindisk.onNotice('Activa el acceso a notificaciones');
check('los avisos nativos llegan a la interfaz', notice.includes('acceso a notificaciones'), notice || '—');

check('parseSnapshot acepta la portada servida', parseSnapshot(payload({ coverUrl: 'https://spindisk.local/art?t=1' }))?.coverUrl === 'https://spindisk.local/art?t=1', 'URL interceptada');
check('parseSnapshot ignora campos basura', parseSnapshot(payload({ currentTime: 'mucho', duration: null }))?.currentTime === 0, '0 s');

// --- la escena reacciona a lo nativo ---------------------------------------
console.log('\nEscena con el puente nativo');
native.calls.length = 0;
native.acceptsSeek = false;
native.current = payload({ title: 'Derrotado En El Dolor', currentTime: 20, canSeek: false });

const turntable = new Turntable(bridge, { ...DEFAULT_PREFERENCES });
await turntable.connect();
const tick = makeTick(turntable);
tick(90);

check('el disco sale al plato', turntable.discOut > 0.9, turntable.discOut.toFixed(2));
check('la aguja baja', turntable.needleDown, 'needleDown');
check('la canción es la que suena en Spotify', turntable.track?.title === title, turntable.track?.title ?? '—');
check('la velocidad es la física', Math.abs(turntable.rpm - 33) < 0.001, `${turntable.rpm} RPM`);

const angleBefore = turntable.armAngle;
turntable.pointerDown('arm', 0, 0);
turntable.pointerMove(1265, 520);
tick(4);
const angleAfter = turntable.armAngle;
turntable.pointerUp();
tick(30);

check(
  'en Free la aguja rebota al punto de la música',
  Math.abs(angleAfter - angleBefore) < 0.03,
  `${(angleAfter - angleBefore).toFixed(3)} rad`,
);
check(
  'y no se manda ningún seek fantasma',
  native.calls.filter((call) => call.startsWith('seek')).length === 0,
  native.calls.join(',') || 'sin llamadas',
);

// Llevarla hasta la galleta sí es un gesto legítimo: salta de canción.
native.calls.length = 0;
turntable.pointerDown('arm', 0, 0);
turntable.pointerMove(700, 300);
tick(3);
turntable.pointerUp();
tick(6);
check(
  'llevar la aguja a la galleta salta a la siguiente',
  native.calls.includes('next'),
  native.calls.join(',') || 'sin llamadas',
);

native.current = payload({ title: 'Seis', currentTime: 0, canSeek: true });
window.__spindisk.onSnapshot(native.current);
clock.now += 500;
tick(40);
check('un salto desde la tablet cambia el disco', turntable.track?.title === 'Seis', turntable.track?.title ?? '—');
check('el disco nuevo vuelve a salir', turntable.discOut > 0.9, turntable.discOut.toFixed(2));

bridge.dispose();
check('dispose() retira los ganchos', window.__spindisk === undefined, 'sin __spindisk');

console.log(
  failures === 0
    ? `\n✓ ${checks}/${checks} comprobaciones · el puente nativo responde`
    : `\n✗ ${checks - failures}/${checks} · ${failures} problema(s)`,
);
process.exit(failures === 0 ? 0 : 1);

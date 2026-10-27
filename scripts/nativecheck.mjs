// `npm run apk` — comprueba que el contrato Kotlin ↔ TypeScript cuadra sin
// compilar nada.
//
// En este PC no hay JDK ni SDK de Android, así que la única forma honesta de
// validar la capa nativa es leer los dos lados y compararlos: nombres de
// métodos, aridad, permisos del manifiesto, carpeta de assets y las rutas que
// el workflow de GitHub Actions va a ejecutar.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const read = (file) => readFile(path.resolve(file), 'utf8');
// Ojo: `//` dentro de una URL no es un comentario, así que sólo se recorta
// cuando va al principio de la línea o detrás de un espacio.
const clean = (file) =>
  file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? '✓' : '✗';
  const pad = '.'.repeat(Math.max(2, 54 - label.length));
  console.log(`  ${mark} ${label}${pad} ${detail}`);
};

const ktBridge = clean(await read('android/app/src/main/kotlin/com/spindisk/tablet/NativeBridge.kt'));
const ktActivity = clean(
  await read('android/app/src/main/kotlin/com/spindisk/tablet/MainActivity.kt'),
);
const ktService = clean(
  await read('android/app/src/main/kotlin/com/spindisk/tablet/MediaListenerService.kt'),
);
const ktHub = clean(await read('android/app/src/main/kotlin/com/spindisk/tablet/MediaHub.kt'));
const ts = clean(await read('src/bridge/android.ts'));
const manifest = await read('android/app/src/main/AndroidManifest.xml');
const workflow = await read('.github/workflows/build-apk.yml').catch(() => '');

// --- métodos que Kotlin expone a JavaScript ---------------------------------
const kotlin = new Map();
for (const match of ktBridge.matchAll(
  /@JavascriptInterface\s*\n\s*fun\s+(\w+)\s*\(([^)]*)\)/g,
)) {
  const params = match[2].trim();
  kotlin.set(match[1], params === '' ? 0 : params.split(',').length);
}

// --- la interfaz TypeScript y sus llamadas ----------------------------------
const handleBlock = ts.match(/interface NativeBridgeHandle \{([\s\S]*?)\n\}/);
const iface = new Map();
for (const match of (handleBlock?.[1] ?? '').matchAll(/^\s{2}(\w+)\(([^)]*)\)/gm)) {
  const params = match[2].trim();
  iface.set(match[1], params === '' ? 0 : params.split(',').length);
}

const calls = new Set([...ts.matchAll(/native\.(\w+)\(/g)].map((match) => match[1]));

console.log('\nContrato Kotlin ↔ TypeScript');
check('Kotlin expone métodos a JavaScript', kotlin.size >= 10, `${kotlin.size} métodos`);
check(
  'cada método de la interfaz existe en Kotlin',
  [...iface.keys()].every((name) => kotlin.has(name)),
  [...iface.keys()].filter((name) => !kotlin.has(name)).join(', ') || 'todos',
);
check(
  'cada llamada de TypeScript existe en Kotlin',
  [...calls].every((name) => kotlin.has(name)),
  [...calls].filter((name) => !kotlin.has(name)).join(', ') || 'todas',
);
check(
  'Kotlin no expone nada que la interfaz ignore',
  [...kotlin.keys()].every((name) => iface.has(name)),
  [...kotlin.keys()].filter((name) => !iface.has(name)).join(', ') || 'sin sobras',
);

const arity = [...iface.entries()].filter(
  ([name, count]) => kotlin.has(name) && kotlin.get(name) !== count,
);
check(
  'mismo número de parámetros en cada método',
  arity.length === 0,
  arity.map(([name, count]) => `${name}(${count} vs ${kotlin.get(name)})`).join(', ') || 'coincide',
);

// --- el sentido contrario: Kotlin llama a la web ----------------------------
const hooks = new Set([...ktActivity.matchAll(/__spindisk\.(\w+)/g)].map((match) => match[1]));
const declared = new Set([...ts.matchAll(/^\s+(on\w+): \(/gm)].map((match) => match[1]));
check(
  'Kotlin sólo llama ganchos que la web declara',
  [...hooks].every((name) => declared.has(name)),
  [...hooks].join(', '),
);
check('la web declara onSnapshot', declared.has('onSnapshot'), 'sí');
check('la web declara onNotice', declared.has('onNotice'), 'sí');

// --- integración de la sesión multimedia -----------------------------------
check(
  'la detección de Premium usa ACTION_SEEK_TO',
  /ACTION_SEEK_TO/.test(ktService),
  'PlaybackState.ACTION_SEEK_TO',
);
check(
  'el servicio late cada 500 ms',
  /POLL_MS\s*=\s*500L/.test(ktService),
  'POLL_MS = 500L',
);
check(
  'lee la portada de la metadata',
  /METADATA_KEY_ALBUM_ART/.test(ktService) && /METADATA_KEY_ART\b/.test(ktService),
  'ALBUM_ART + ART',
);
check(
  'la portada se sirve por URL interceptada',
  /spindisk\.local\/art/.test(ktHub) && /spindisk\.local/.test(ktActivity),
  'https://spindisk.local/art',
);
check(
  'la respuesta de la portada abre CORS',
  /Access-Control-Allow-Origin/.test(ktActivity),
  'para que el lienzo lea los colores',
);
check(
  'la web carga desde los assets',
  /file:\/\/\/android_asset\/www\/index\.html/.test(ktActivity),
  'file:///android_asset/www/index.html',
);

// --- manifiesto -------------------------------------------------------------
console.log('\nManifiesto');
check('declara la actividad', /android:name="\.MainActivity"/.test(manifest), 'MainActivity');
check(
  'declara el servicio de notificaciones',
  /android:name="\.MediaListenerService"/.test(manifest) &&
    /BIND_NOTIFICATION_LISTENER_SERVICE/.test(manifest),
  'con su permiso',
);
check(
  'orientación horizontal',
  /android:screenOrientation="sensorLandscape"/.test(manifest),
  'sensorLandscape',
);
check(
  'puede convivir en ventana dividida',
  /android:resizeableActivity="true"/.test(manifest),
  'resizeableActivity',
);
const pkgs = ['com.spotify.music', 'com.google.android.apps.youtube.music', 'com.google.android.youtube'];
check(
  'declara las tres apps de música',
  pkgs.every((pkg) => manifest.includes(pkg)),
  `${pkgs.length} paquetes en <queries>`,
);
check('pide VIBRATE', /android.permission.VIBRATE/.test(manifest), 'para el rebote del brazo');
check(
  'no pide INTERNET para audio',
  /android.permission.INTERNET/.test(manifest),
  'sólo para la letra de LRCLIB',
);

// --- empaquetado ------------------------------------------------------------
console.log('\nEmpaquetado');
const www = path.resolve('android/app/src/main/assets/www');
const index = await stat(path.join(www, 'index.html')).catch(() => null);
const main = await stat(path.join(www, 'main.js')).catch(() => null);
check('assets/www/index.html existe', Boolean(index), index ? 'sí' : 'corre `npm run native`');
check('assets/www/main.js existe', Boolean(main), main ? 'sí' : 'falta compilar');

const gradleApp = await read('android/app/build.gradle').catch(() => '');
check(
  'el módulo declara el namespace',
  /namespace 'com\.spindisk\.tablet'/.test(gradleApp),
  'com.spindisk.tablet',
);
check(
  'no hay dependencias de terceros',
  /dependencies\s*\{\s*\}/.test(gradleApp),
  'cero',
);
check(
  'compileSdk 34 y minSdk 24',
  /compileSdk 34/.test(gradleApp) && /minSdk 24/.test(gradleApp),
  'tablet con Android 7+',
);

// --- workflow ---------------------------------------------------------------
console.log('\nGitHub Actions');
check('existe el workflow', workflow.length > 0, '.github/workflows/build-apk.yml');
check(
  'compila la web antes del APK',
  /npm run build/.test(workflow) && /native\.mjs/.test(workflow),
  'build + assets',
);
check(
  'usa Java 17 y Gradle',
  /java-version:\s*'17'/.test(workflow) && /gradle/.test(workflow),
  'temurin + setup-gradle',
);
check(
  'publica el APK con nombre propio',
  /upload-artifact/.test(workflow) && /spindisk\.apk/.test(workflow),
  'spindisk.apk descargable',
);
check(
  'guarda la clave de firma entre compilaciones',
  /actions\/cache@v4/.test(workflow) && /debug\.keystore/.test(workflow),
  'así una actualización se instala encima',
);

console.log(
  failures === 0
    ? `\n✓ ${checks}/${checks} comprobaciones · el contrato nativo cuadra`
    : `\n✗ ${checks - failures}/${checks} · ${failures} problema(s)`,
);
process.exit(failures === 0 ? 0 : 1);

/**
 * El "falso Android": comprobaciones del SandboxBridge.
 *
 * El simulador tiene que comportarse como Spotify, porque es contra él con lo
 * que se prueba todo lo demás en el navegador: si al terminar una canción no
 * pasa a la siguiente, en la tablet no sabes si falla el motor o el simulador.
 * Usa temporizadores reales, así que este banco tarda un par de segundos.
 */

import { build, installDom, installFonts } from './harness.mjs';

installFonts();
installDom({ offline: true });
// El simulador late con su propio reloj de pared; aquí no hay tocadiscos que
// pueda falsearse, así que se le devuelve un reloj monótono de verdad.
Object.defineProperty(globalThis.performance, 'now', {
  value: () => Number(process.hrtime.bigint() / 1_000_000n),
  writable: true,
  configurable: true,
});
build();

const { SandboxBridge } = await import('../dist/bridge/sandbox.js');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${label.padEnd(52, '.')} ${detail}\n`);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const track = (title, duration) => ({
  id: title.toLowerCase(),
  title,
  artist: 'Prueba',
  album: 'Discos de prueba',
  coverUrl: null,
  duration,
});

/** Arranca un simulador con cola y devuelve el orden en que sonaron. */
const runAlbum = async (titles, duration, ms) => {
  const bridge = new SandboxBridge();
  const played = [];
  bridge.subscribe((snap) => {
    if (!snap) return;
    if (played[played.length - 1] !== snap.title) played.push(snap.title);
  });
  const album = titles.map((title) => track(title, duration));
  bridge.setQueue(album, 0);
  await bridge.load(album[0]);
  await wait(ms);
  bridge.dispose();
  return { played, bridge };
};

process.stdout.write('\nCola del simulador\n');

// Sin cola (una sola canción) se reinicia: eso es «repetir una», no un fallo.
const lone = new SandboxBridge();
const loneSeen = [];
lone.subscribe((snap) => {
  if (snap) loneSeen.push(snap.title);
});
const only = track('Única', 0.5);
await lone.load(only);
await wait(1100);
lone.dispose();
check('sin cola sigue sonando la misma', new Set(loneSeen).size === 1 && loneSeen[0] === 'Única', `títulos: ${[...new Set(loneSeen)].join(' → ')}`);
check('y el cronómetro se reinició', loneSeen.length > 5, `${loneSeen.length} instantáneas`);

// Con cola: al terminar, la siguiente del disco.
const album = await runAlbum(['Uno', 'Dos', 'Tres'], 0.5, 1900);
const order = album.played.join(' → ');
check('al terminar una pista suena la siguiente', album.played[1] === 'Dos', order);
check('y el disco sigue avanzando', album.played[2] === 'Tres', order);
check('al acabar el disco vuelve al principio', album.played.includes('Uno') && album.played[3] === 'Uno', order);

// Controles explícitos sobre la cola.
const manual = new SandboxBridge();
const manualSeen = [];
manual.subscribe((snap) => {
  if (snap) manualSeen.push(snap.title);
});
const list = ['A', 'B', 'C'].map((title) => track(title, 200));
manual.setQueue(list, 0);
await manual.load(list[0]);
await manual.next();
check('«siguiente» cambia de canción de verdad', manualSeen[manualSeen.length - 1] === 'B', manualSeen.join(' → '));
await manual.previous();
check('«anterior» con menos de 3 s vuelve atrás', manualSeen[manualSeen.length - 1] === 'A', manualSeen.slice(-1).join(''));

manual.setCanSeek(false);
const blocked = await manual.seek(30);
manual.setCanSeek(true);
const allowed = await manual.seek(30);
manual.dispose();
check('en modo Free el simulador no deja buscar', blocked === false, `seek → ${blocked}`);
check('en modo completo sí deja', allowed === true, `seek → ${allowed}`);

process.stdout.write(
  `\n  ${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'el simulador se comporta' : `${failures} comprobación(es) fallida(s)`}\n\n`,
);
process.exit(failures === 0 ? 0 : 1);

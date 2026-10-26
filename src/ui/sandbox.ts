/**
 * Menú secreto F2: el "falso Android".
 *
 * Simula lo que en la tablet entrega el sistema: elige una canción real (iTunes),
 * trae su portada y su letra (LRCLIB) y controla el reloj de reproducción.
 */

import { searchTracks, type ITunesSearchResult } from '../bridge/sandbox.js';
import type { SandboxBridge } from '../bridge/sandbox.js';
import type { Notify } from './toast.js';

export interface SandboxUi {
  readonly isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  sync: () => void;
}

/** Lo que el panel necesita del tocadiscos y no pasa por el puente. */
export interface SandboxHooks {
  /** Entra en modo reloj sin esperar el minuto de reposo. */
  forceClock?: () => void;
  /** Milisegundos que faltan para el reloj (`Infinity` si no hace falta). */
  clockIn?: () => number;
  /** ¿La hora ya está a la vista en la funda? */
  isClock?: () => boolean;
}

const SUGGESTIONS = [
  'Kaleth Morales',
  'Silvana Estrada',
  'Natalia Lafourcade',
  'Jorge Drexler',
  'Los Hermanos Zuleta',
  'Fleetwood Mac Dreams',
  'Mac DeMarco',
  'Vicente García',
  'Café Tacvba',
  'Rosalía',
  'Bill Evans',
  'Diomedes Díaz',
];

const TEMPLATE = `
  <div class="sandbox__head">
    <span class="sandbox__title">Sandbox · F2</span>
    <button class="sandbox__close" type="button" aria-label="Cerrar">×</button>
  </div>
  <form class="sandbox__search">
    <input class="sandbox__term" type="search" placeholder="Canción o artista…" autocomplete="off" />
    <button class="ghost" type="submit">Buscar</button>
  </form>
  <div class="sandbox__results"></div>
  <div class="sandbox__row">
    <span class="sandbox__title">Cuenta</span>
    <div class="mini-switch" role="group" aria-label="Modo de cuenta">
      <button type="button" data-free>Spotify Free</button>
      <button type="button" data-premium class="is-active">Premium</button>
    </div>
  </div>
  <div class="sandbox__row">
    <button class="ghost" type="button" data-burst>Simular 5 saltos</button>
    <button class="ghost" type="button" data-random>Sorpréndeme</button>
  </div>
  <div class="sandbox__row">
    <button class="ghost" type="button" data-clock>Modo reloj ahora</button>
    <span class="sandbox__hint" data-clock-hint></span>
  </div>
  <p class="sandbox__hint" data-now>Sin nada sonando.</p>
  <p class="sandbox__hint">
    Búsqueda y portadas reales (iTunes) · letra real (LRCLIB). En la tablet, MediaSession
    sustituye todo esto sin cambiar una línea del render.
  </p>
`;

export const mountSandbox = (
  bridge: SandboxBridge,
  notify: Notify,
  hooks: SandboxHooks = {},
): SandboxUi => {
  const root = document.getElementById('sandbox');
  if (!root) throw new Error('Falta #sandbox');
  root.innerHTML = TEMPLATE;

  const input = root.querySelector<HTMLInputElement>('.sandbox__term');
  const results = root.querySelector<HTMLElement>('.sandbox__results');
  const nowLine = root.querySelector<HTMLElement>('[data-now]');
  const clockHint = root.querySelector<HTMLElement>('[data-clock-hint]');
  const freeBtn = root.querySelector<HTMLButtonElement>('[data-free]');
  const premiumBtn = root.querySelector<HTMLButtonElement>('[data-premium]');
  if (!input || !results || !nowLine || !freeBtn || !premiumBtn) {
    throw new Error('Sandbox incompleto');
  }

  let open = false;
  let debounce = 0;
  let searchToken = 0;
  let shortcutUsed = false;

  const show = (): void => {
    open = true;
    root.hidden = false;
    input.focus();
  };

  const hide = (): void => {
    open = false;
    root.hidden = true;
    input.blur();
  };

  const setAccount = (canSeek: boolean): void => {
    premiumBtn.classList.toggle('is-active', canSeek);
    freeBtn.classList.toggle('is-active', !canSeek);
    bridge.setCanSeek(canSeek);
    notify(
      canSeek
        ? 'Modo Premium: el brazo y el disco pueden adelantar o retroceder'
        : 'Modo Spotify Free: el brazo se resiste a retroceder',
      3200,
    );
  };

  const playTrack = (track: ITunesSearchResult, label: string, list?: ITunesSearchResult[]): void => {
    // La lista encontrada pasa a ser la cola: así "siguiente" cambia de disco
    // de verdad y el antirrebote se puede probar desde el panel.
    if (list && list.length > 1) {
      bridge.setQueue(list, list.indexOf(track));
    }
    void bridge.load(track);
    results.innerHTML = '';
    input.value = '';
    notify(`Sonando ${label}`);
  };

  const renderResults = (list: ITunesSearchResult[]): void => {
    results.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sandbox__hint';
      empty.textContent = 'Sin resultados. Prueba con otro nombre.';
      results.append(empty);
      return;
    }
    for (const track of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';

      const img = document.createElement('img');
      img.src = track.coverUrl;
      img.alt = '';
      img.loading = 'lazy';

      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = track.title;
      const sub = document.createElement('small');
      sub.textContent = `${track.artist}${track.album ? ' · ' + track.album : ''}`;
      text.append(title, sub);
      button.append(img, text);

      button.addEventListener('click', () =>
        playTrack(track, `${track.title} — ${track.artist}`, list),
      );
      results.append(button);
    }
  };

  const runSearch = async (term: string): Promise<void> => {
    const token = ++searchToken;
    const query = term.trim();
    if (!query) {
      renderResults([]);
      return;
    }
    const waiting = document.createElement('p');
    waiting.className = 'sandbox__hint';
    waiting.textContent = 'Buscando en el archivo…';
    results.replaceChildren(waiting);
    try {
      const found = await searchTracks(query, 8);
      if (token !== searchToken) return;
      renderResults(found);
    } catch {
      if (token !== searchToken) return;
      const failed = document.createElement('p');
      failed.className = 'sandbox__hint';
      failed.textContent = 'No hubo respuesta de la búsqueda. ¿Hay conexión?';
      results.replaceChildren(failed);
    }
  };

  input.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void runSearch(input.value), 420);
  });

  const form = root.querySelector('form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(debounce);
    void runSearch(input.value);
  });

  freeBtn.addEventListener('click', () => setAccount(false));
  premiumBtn.addEventListener('click', () => setAccount(true));

  root.querySelector('[data-burst]')?.addEventListener('click', () => {
    if (!bridge.state.track) {
      notify('Primero pon algo a sonar');
      return;
    }
    bridge.burst(5);
    notify('5 saltos rápidos: el disco espera dentro de la funda', 3200);
  });

  root.querySelector('[data-clock]')?.addEventListener('click', () => {
    if (!hooks.forceClock) return;
    hooks.forceClock();
    notify('Modo reloj: el disco se guarda y la hora aparece en la funda');
  });

  root.querySelector('[data-random]')?.addEventListener('click', async () => {
    if (shortcutUsed) return;
    shortcutUsed = true;
    const term = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)] ?? 'Boleros';
    input.value = term;
    window.clearTimeout(debounce);
    try {
      const found = await searchTracks(term, 5);
      if (found[0]) playTrack(found[0], `${found[0].title} — ${found[0].artist}`, found);
      else notify('Sin resultados para la sugerencia');
    } catch {
      notify('La búsqueda no respondió');
    } finally {
      shortcutUsed = false;
    }
  });

  root.querySelector('.sandbox__close')?.addEventListener('click', hide);

  const api: SandboxUi = {
    get isOpen() {
      return open;
    },
    open: show,
    close: hide,
    toggle: () => (open ? hide() : show()),
    sync: () => {
      const state = bridge.state;
      if (!state.track) {
        nowLine.textContent = 'Sin nada sonando. Busca una canción para empezar.';
      } else {
        nowLine.textContent = `${state.track.title} — ${state.track.artist} · ${state.playing ? 'sonando' : 'en pausa'}`;
      }
      premiumBtn.classList.toggle('is-active', state.canSeek);
      freeBtn.classList.toggle('is-active', !state.canSeek);
      if (clockHint && hooks.clockIn) {
        const ms = hooks.clockIn();
        const shown = hooks.isClock?.() === true;
        clockHint.textContent = shown
          ? 'reloj a la vista'
          : ms <= 0
            ? 'el reloj está asomando'
            : state.playing
              ? 'suena música: el reloj espera'
              : Number.isFinite(ms)
                ? `el reloj asoma en ${Math.ceil(ms / 1000)} s`
                : 'en pausa: el reloj ya está a la vista';
      }
    },
  };

  api.sync();
  return api;
};

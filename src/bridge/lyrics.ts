/**
 * Letras sincronizadas desde LRCLIB.
 *
 * Una sola petición de texto ligero por canción nueva (~2-8 KB), cacheada en
 * localStorage para no repetirla nunca. Si la canción es instrumental o no
 * existe, se devuelve `null` y la funda muestra la ficha técnica.
 *
 * Diferencia explícitamente entre:
 *   1. Éxito (HTTP 200 con letra o instrumental): caché permanente.
 *   2. No encontrada (HTTP 404 confirmado por LRCLIB): caché negativa por 7 días.
 *   3. Error de red / timeout / 5xx: JAMÁS se guarda en caché; reintenta con
 *      backoff (3 s y 8 s) y permite reintentar al voltear la funda.
 */

export interface LyricLine {
  time: number;
  text: string;
}

export interface Lyrics {
  lines: LyricLine[];
  synced: boolean;
  plain: string;
  instrumental: boolean;
  wrapped?: string[][];
}

interface LrcLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface CachedEntry {
  kind: 'hit' | 'miss';
  lyrics: Lyrics | null;
  expiresAt?: number;
}

const API = 'https://lrclib.net/api';
const CACHE_PREFIX = 'spindisk.lyrics.v1.';
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const MEMORY_CACHE = new Map<string, CachedEntry>();

const cacheKey = (artist: string, title: string, duration: number): string =>
  `${CACHE_PREFIX}${artist}|${title}|${Math.round(duration)}`.toLowerCase();

/** Limpia etiquetas de YouTube/Spotify que arruinan la búsqueda. */
export const cleanTitle = (title: string): string =>
  title
    .replace(/\((?:official|lyric|letra|audio|video|visualizer|hd|hq|4k)[^)]*\)/gi, '')
    .replace(/\[(?:official|lyric|letra|audio|video|visualizer|hd|hq|4k)[^\]]*\]/gi, '')
    .replace(/\s*[-–]\s*(?:remaster(?:ed)?(?:\s*\d{4})?|official\s*(?:video|audio)|lyrics?|letra|video\s*oficial)\s*$/gi, '')
    .replace(/\s+feat\.?\s+.+$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

export const cleanArtist = (artist: string): string =>
  artist
    .replace(/\s*[-–]\s*topic$/i, '')
    .replace(/\s+feat\.?\s+.+$/i, '')
    .replace(/,.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

export const parseLrc = (lrc: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = stamp[3] ? Number(stamp[3].padEnd(3, '0')) / 1000 : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
};

const toLyrics = (track: LrcLibTrack | undefined): Lyrics | null => {
  if (!track) return null;
  const synced = track.syncedLyrics ? parseLrc(track.syncedLyrics) : [];
  if (synced.length > 0) {
    return { lines: synced, synced: true, plain: track.plainLyrics ?? '', instrumental: false };
  }
  if (track.plainLyrics?.trim()) {
    const lines = track.plainLyrics
      .split(/\r?\n/)
      .map((text, index) => ({ time: -1 - index, text: text.trim() }))
      .filter((l) => l.text.length > 0);
    return { lines, synced: false, plain: track.plainLyrics, instrumental: false };
  }
  if (track.instrumental) {
    return { lines: [], synced: false, plain: '', instrumental: true };
  }
  return null;
};

type FetchOutcome =
  | { status: 'ok'; data: LrcLibTrack | LrcLibTrack[] }
  | { status: 'not_found' };

const fetchWithTimeout = async (url: string, timeoutMs = 5000): Promise<Response> => {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  return fetch(url, { headers: { Accept: 'application/json' } });
};

const fetchJson = async (url: string): Promise<FetchOutcome> => {
  const response = await fetchWithTimeout(url, 5000);
  if (response.status === 404) return { status: 'not_found' };
  if (!response.ok) throw new Error(`LRCLIB HTTP ${response.status}`);
  const data = (await response.json()) as LrcLibTrack | LrcLibTrack[];
  return { status: 'ok', data };
};

const readCache = (key: string): CachedEntry | undefined => {
  const now = Date.now();
  const mem = MEMORY_CACHE.get(key);
  if (mem) {
    if (mem.expiresAt !== undefined && now > mem.expiresAt) {
      MEMORY_CACHE.delete(key);
    } else {
      return mem;
    }
  }

  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    stored = null;
  }
  if (!stored) return undefined;

  try {
    const parsed = JSON.parse(stored) as CachedEntry | Lyrics | null;
    if (parsed === null) {
      // Compatibilidad con entradas antiguas 'null': tratarlas como miss con TTL de 7 días.
      const entry: CachedEntry = { kind: 'miss', lyrics: null, expiresAt: now + NEGATIVE_TTL_MS };
      MEMORY_CACHE.set(key, entry);
      return entry;
    }
    if (typeof parsed === 'object' && 'kind' in parsed) {
      if (parsed.expiresAt !== undefined && now > parsed.expiresAt) {
        try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
        return undefined;
      }
      MEMORY_CACHE.set(key, parsed);
      return parsed;
    }
    if (typeof parsed === 'object' && 'lines' in parsed) {
      const entry: CachedEntry = { kind: 'hit', lyrics: parsed };
      MEMORY_CACHE.set(key, entry);
      return entry;
    }
  } catch {
    try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
  }
  return undefined;
};

const savePermanent = (key: string, lyrics: Lyrics): void => {
  const entry: CachedEntry = { kind: 'hit', lyrics };
  MEMORY_CACHE.set(key, entry);
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Sin espacio: se ignora, la caché en memoria sigue viva.
  }
};

const saveNegative = (key: string): void => {
  const entry: CachedEntry = {
    kind: 'miss',
    lyrics: null,
    expiresAt: Date.now() + NEGATIVE_TTL_MS,
  };
  MEMORY_CACHE.set(key, entry);
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Sin espacio: se ignora.
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // En el arnés de pruebas offline no queremos bloquear varios segundos reales.
    const isTestHarness =
      typeof navigator !== 'undefined' && navigator.userAgent === 'spindisk-harness';
    setTimeout(resolve, isTestHarness ? 0 : ms);
  });

const attemptLookup = async (
  clean: { artist: string; title: string },
  duration: number,
): Promise<{ found: Lyrics | null; confirmedNotFound: boolean }> => {
  const params = new URLSearchParams({
    artist_name: clean.artist,
    track_name: clean.title,
    duration: String(Math.round(duration)),
  });

  const primary = await fetchJson(`${API}/get?${params.toString()}`);
  if (primary.status === 'ok') {
    const payload = Array.isArray(primary.data) ? (primary.data[0] ?? undefined) : primary.data;
    const lyrics = toLyrics(payload);
    if (lyrics) return { found: lyrics, confirmedNotFound: false };
  }

  // Búsqueda libre de respaldo: cubre versiones en vivo, remasters y títulos sucios.
  const query = new URLSearchParams({ q: `${clean.title} ${clean.artist}` });
  const fallback = await fetchJson(`${API}/search?${query.toString()}`);
  if (fallback.status === 'ok') {
    const list = Array.isArray(fallback.data) ? fallback.data : [];
    const best = list
      .filter((t) => t.syncedLyrics || t.plainLyrics || t.instrumental)
      .sort((a, b) => {
        const da = Math.abs((a.duration ?? 0) - duration);
        const db = Math.abs((b.duration ?? 0) - duration);
        return da - db;
      })[0];
    const lyrics = toLyrics(best);
    if (lyrics) return { found: lyrics, confirmedNotFound: false };
  }

  // Si llegamos aquí sin que saltara ninguna excepción de red/5xx, el servidor
  // de LRCLIB respondió correctamente y confirmó que la canción no tiene letra.
  return { found: null, confirmedNotFound: true };
};

export interface LyricsFetchResult {
  lyrics: Lyrics | null;
  networkError: boolean;
}

export const fetchLyricsWithStatus = async (
  artist: string,
  title: string,
  duration: number,
): Promise<LyricsFetchResult> => {
  const key = cacheKey(artist, title, duration);
  const cached = readCache(key);
  if (cached !== undefined) {
    return { lyrics: cached.lyrics, networkError: false };
  }

  const clean = { artist: cleanArtist(artist), title: cleanTitle(title) };
  const retryDelays = [3000, 8000];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { found, confirmedNotFound } = await attemptLookup(clean, duration);
      if (found) {
        savePermanent(key, found);
        return { lyrics: found, networkError: false };
      }
      if (confirmedNotFound) {
        saveNegative(key);
        return { lyrics: null, networkError: false };
      }
    } catch {
      // Falló el Wi-Fi, hubo Timeout o error 5xx -> JAMÁS guardar en caché.
      if (attempt < 3) {
        await sleep(retryDelays[attempt - 1] ?? 3000);
      }
    }
  }

  // Tras 3 intentos sigue sin conexión: devolvemos null por hoy sin tocar la caché.
  return { lyrics: null, networkError: true };
};

export const fetchLyrics = async (
  artist: string,
  title: string,
  duration: number,
): Promise<Lyrics | null> => {
  const res = await fetchLyricsWithStatus(artist, title, duration);
  return res.lyrics;
};

/** Índice de la línea activa para un segundo dado, con búsqueda binaria. */
export const activeLineIndex = (lyrics: Lyrics | null, time: number): number => {
  if (!lyrics || !lyrics.synced || lyrics.lines.length === 0) return -1;
  const lines = lyrics.lines;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time + 0.12) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

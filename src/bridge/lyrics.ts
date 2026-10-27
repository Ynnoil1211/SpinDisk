/**
 * Letras sincronizadas desde LRCLIB.
 *
 * Una sola petición de texto ligero por canción nueva (~2-8 KB), cacheada en
 * localStorage para no repetirla nunca. Si la canción es instrumental o no
 * existe, se devuelve `null` y la funda muestra la ficha técnica.
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

const API = 'https://lrclib.net/api';
const CACHE_PREFIX = 'spindisk.lyrics.v1.';
const MEMORY_CACHE = new Map<string, Lyrics | null>();

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

const fetchJson = async (url: string): Promise<LrcLibTrack | LrcLibTrack[] | null> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LRCLIB ${response.status}`);
  return (await response.json()) as LrcLibTrack | LrcLibTrack[];
};

export const fetchLyrics = async (
  artist: string,
  title: string,
  duration: number,
): Promise<Lyrics | null> => {
  const key = cacheKey(artist, title, duration);
  if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key) ?? null;

  // La consulta a localStorage puede lanzar (modo privado, o un WebView que no
  // deja almacenar desde file://): sin caché se sigue, pero que no reviente.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    stored = null;
  }
  if (stored) {
    try {
      const parsed = stored === 'null' ? null : (JSON.parse(stored) as Lyrics);
      MEMORY_CACHE.set(key, parsed);
      return parsed;
    } catch {
      localStorage.removeItem(key);
    }
  }

  const clean = { artist: cleanArtist(artist), title: cleanTitle(title) };
  const params = new URLSearchParams({
    artist_name: clean.artist,
    track_name: clean.title,
    duration: String(Math.round(duration)),
  });
  if (duration > 0) params.set('album_name', '');

  let result: Lyrics | null = null;
  try {
    let payload = await fetchJson(`${API}/get?${params.toString()}`);
    if (Array.isArray(payload)) payload = payload[0] ?? null;
    result = toLyrics(payload ?? undefined);
  } catch {
    result = null;
  }

  if (!result) {
    // Búsqueda libre: cubre versiones en vivo, remasters y títulos sucios.
    try {
      const query = new URLSearchParams({ q: `${clean.title} ${clean.artist}` });
      const payload = await fetchJson(`${API}/search?${query.toString()}`);
      const list = Array.isArray(payload) ? payload : [];
      const best = list
        .filter((t) => t.syncedLyrics || t.plainLyrics)
        .sort((a, b) => {
          const da = Math.abs((a.duration ?? 0) - duration);
          const db = Math.abs((b.duration ?? 0) - duration);
          return da - db;
        })[0];
      result = toLyrics(best);
    } catch {
      result = null;
    }
  }

  MEMORY_CACHE.set(key, result);
  try {
    localStorage.setItem(key, JSON.stringify(result));
  } catch {
    // Sin espacio: se ignora, la caché en memoria sigue viva.
  }
  return result;
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

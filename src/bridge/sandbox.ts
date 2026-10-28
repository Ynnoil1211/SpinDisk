/**
 * SandboxBridge: el "falso Android".
 *
 * Simula lo que en la tablet entrega el sistema (pista, portada, progreso,
 * capacidades de seek). En el navegador nos deja probar el 95% de la app:
 * búsqueda real en iTunes, portada real, letra real de LRCLIB y un reloj de
 * reproducción local.
 */

import type { PlayerBridge, TrackSnapshot } from '../core/types.js';

export interface SandboxTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
}

interface ITunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  kind?: string;
}

const TICK_MS = 120;

export class SandboxBridge implements PlayerBridge {
  readonly kind = 'sandbox' as const;

  private listeners = new Set<(snapshot: TrackSnapshot | null) => void>();
  private track: SandboxTrack | null = null;
  private queue: SandboxTrack[] = [];
  private cursor = 0;
  private time = 0;
  private playing = false;
  private canSeek = true;
  private deviceVolume = 0.75;
  private lastTick = 0;
  private timer: number | null = null;
  private seekLockedUntil = 0;

  constructor() {
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  async connect(): Promise<void> {
    this.emit();
  }

  subscribe(listener: (snapshot: TrackSnapshot | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Datos para el panel de pruebas. */
  get state(): { track: SandboxTrack | null; time: number; playing: boolean; canSeek: boolean } {
    return { track: this.track, time: this.time, playing: this.playing, canSeek: this.canSeek };
  }

  get seekLocked(): boolean {
    return performance.now() < this.seekLockedUntil;
  }

  setCanSeek(value: boolean): void {
    this.canSeek = value;
    this.emit();
  }

  async load(track: SandboxTrack): Promise<void> {
    if (this.queue.length === 0) this.queue = [{ ...track }];
    this.track = { ...track };
    this.time = 0;
    this.playing = true;
    this.lastTick = performance.now();
    this.emit();
  }

  /**
   * Cola de reproducción: es lo que hace que "siguiente" cambie de verdad de
   * canción (portada, título y duración) y no sólo reinicie el cronómetro.
   * Sin cola no se puede probar el golpe de disco ni el antirrebote.
   */
  setQueue(tracks: SandboxTrack[], index = 0): void {
    this.queue = tracks.map((t) => ({ ...t }));
    this.cursor = Math.max(0, Math.min(index, this.queue.length - 1));
  }

  get queueSize(): number {
    return this.queue.length;
  }

  private step(delta: number): void {
    if (this.queue.length === 0) return;
    this.cursor = (this.cursor + delta + this.queue.length) % this.queue.length;
    const next = this.queue[this.cursor];
    if (!next) return;
    this.track = { ...next };
    this.time = 0;
    this.playing = true;
    this.lastTick = performance.now();
    this.emit();
  }

  async play(): Promise<void> {
    if (!this.track) return;
    this.playing = true;
    this.lastTick = performance.now();
    this.emit();
  }

  async pause(): Promise<void> {
    this.playing = false;
    this.emit();
  }

  async next(): Promise<void> {
    if (!this.track) return;
    if (this.queue.length > 1) {
      this.step(1);
      return;
    }
    this.time = 0;
    this.lastTick = performance.now();
    this.emit();
  }

  async previous(): Promise<void> {
    if (!this.track) return;
    // Como en cualquier reproductor: si ya avanzó, vuelve al principio.
    if (this.queue.length > 1 && this.time <= 3) {
      this.step(-1);
      return;
    }
    this.time = 0;
    this.lastTick = performance.now();
    this.emit();
  }

  async seek(seconds: number): Promise<boolean> {
    if (!this.track || !this.canSeek) return false;
    this.time = Math.max(0, Math.min(this.track.duration - 0.25, seconds));
    this.lastTick = performance.now();
    this.emit();
    return true;
  }

  getVolume(): number {
    return this.deviceVolume;
  }

  setVolume(level: number): boolean {
    this.deviceVolume = Math.max(0, Math.min(1, level));
    return true;
  }

  async openSource(): Promise<void> {
    const q = this.track ? encodeURIComponent(`${this.track.title} ${this.track.artist}`) : '';
    window.open(`https://open.spotify.com/search/${q}`, '_blank', 'noopener');
  }

  /** Simula varios "siguiente" seguidos para probar el debounce del disco. */
  burst(count = 5): void {
    let n = 0;
    const fire = (): void => {
      void this.next();
      n += 1;
      if (n < count) window.setTimeout(fire, 110);
    };
    fire();
  }

  private tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.track || !this.playing) return;
    this.time += dt;
    if (this.track.duration > 0 && this.time >= this.track.duration - 0.15) {
      // Con cola el disco sigue: la siguiente pista del álbum. Sin cola se
      // reinicia, que es lo que hace un reproductor con una sola canción
      // («repetir una»). El tocadiscos no decide esto en la tablet: allí lo
      // manda Spotify y aquí lo imita el simulador.
      if (this.queue.length > 1) {
        this.step(1);
        return;
      }
      this.time = 0;
      this.lastTick = now;
      this.emit();
      return;
    }
    this.emit();
  }

  private snapshot(): TrackSnapshot | null {
    if (!this.track) return null;
    return {
      id: this.track.id,
      title: this.track.title,
      artist: this.track.artist,
      album: this.track.album,
      coverUrl: this.track.coverUrl,
      currentTime: this.time,
      duration: this.track.duration,
      isPlaying: this.playing,
      canSeek: this.canSeek,
      source: 'spotify',
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

export interface ITunesSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
}

const upscaleArtwork = (url: string, size = 600): string =>
  url.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}x${size}bb.$1`);

export const searchTracks = async (term: string, limit = 10): Promise<ITunesSearchResult[]> => {
  const query = encodeURIComponent(term.trim());
  if (!query) return [];
  const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes respondió ${response.status}`);
  const payload = (await response.json()) as { results?: ITunesResult[] };
  return (payload.results ?? [])
    .filter((r) => r.kind === 'song' && r.trackName && r.artistName)
    .map((r) => ({
      id: String(r.trackId ?? `${r.trackName}-${r.artistName}`),
      title: r.trackName as string,
      artist: r.artistName as string,
      album: r.collectionName ?? '',
      coverUrl: r.artworkUrl100 ? upscaleArtwork(r.artworkUrl100) : '',
      duration: (r.trackTimeMillis ?? 0) / 1000,
    }));
};

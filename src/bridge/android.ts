/**
 * AndroidBridge: habla con `NativeBridge.kt` a través de la WebView.
 *
 * Cuando la app corre instalada en la tablet, éste es el puente que lee la
 * sesión multimedia real (Spotify, YouTube Music, YouTube) y manda comandos al
 * sistema. En el navegador nunca se instancia: ahí manda el Sandbox.
 *
 * El contrato es a propósito pequeño y plano. El lado Kotlin está en
 * `android/app/src/main/kotlin/com/spindisk/tablet/NativeBridge.kt`; si uno de
 * los dos cambia, `node scripts/nativecheck.mjs` lo detecta sin necesidad de
 * compilar nada.
 */

import type { PlayerBridge, SourceApp, TrackSnapshot } from '../core/types.js';

/** Espejo exacto de los métodos anotados con `@JavascriptInterface`. */
interface NativeBridgeHandle {
  platform(): string;
  start(): boolean;
  snapshot(): string;
  listening(): boolean;
  play(): boolean;
  pause(): boolean;
  next(): boolean;
  previous(): boolean;
  seek(seconds: number): boolean;
  openSource(floating: boolean): void;
  notificationAccess(): boolean;
  openNotificationSettings(): void;
}

/** Lo que Kotlin llama desde el otro lado. */
interface HostHooks {
  onSnapshot(raw: string): void;
  onNotice(message: string): void;
}

type NativeWindow = Window & {
  SpinDiskNative?: NativeBridgeHandle;
  __spindisk?: HostHooks;
};

const host = (): NativeWindow => window as NativeWindow;

const handle = (): NativeBridgeHandle | null => host().SpinDiskNative ?? null;

export const isNativeShell = (): boolean => {
  const native = handle();
  return typeof native?.platform === 'function' && native.platform() === 'android';
};

const SOURCES: readonly SourceApp[] = [
  'spotify',
  'youtube-music',
  'youtube',
  'local',
  'unknown',
];

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Convierte el JSON de Kotlin en la instantánea del contrato. */
export const parseSnapshot = (raw: string): TrackSnapshot | null => {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const row = data as Record<string, unknown>;
  const title = typeof row['title'] === 'string' ? row['title'].trim() : '';
  if (!title) return null;

  const source = SOURCES.find((candidate) => candidate === row['source']) ?? 'unknown';
  const coverUrl = typeof row['coverUrl'] === 'string' && row['coverUrl'] ? row['coverUrl'] : undefined;
  const album = typeof row['album'] === 'string' && row['album'] ? row['album'] : undefined;

  return {
    title,
    artist: typeof row['artist'] === 'string' ? row['artist'] : '',
    album,
    coverUrl,
    currentTime: Math.max(0, num(row['currentTime'])),
    duration: Math.max(0, num(row['duration'])),
    isPlaying: row['isPlaying'] === true,
    canSeek: row['canSeek'] === true,
    source,
  };
};

/** Aviso para la interfaz (se muestra como el resto de los avisos). */
export const NATIVE_NOTICE = 'spindisk:notice';

export class AndroidBridge implements PlayerBridge {
  readonly kind = 'android' as const;

  private listeners = new Set<(snapshot: TrackSnapshot | null) => void>();

  async connect(): Promise<void> {
    const native = handle();
    if (!native) throw new Error('NativeBridge no disponible');

    host().__spindisk = {
      onSnapshot: (raw: string) => {
        for (const listener of this.listeners) listener(parseSnapshot(raw));
      },
      onNotice: (message: string) => {
        window.dispatchEvent(new CustomEvent(NATIVE_NOTICE, { detail: message }));
      },
    };

    const listening = native.start();
    // `false` = todavía no hay acceso a notificaciones: el aviso ya lo dio
    // la actividad, aquí sólo se deja constancia para quien depure.
    if (!listening) console.warn('SpinDisk: sin acceso a notificaciones todavía');

    // La página puede cargarse después del último latido; se pide el estado ya.
    const current = parseSnapshot(native.snapshot());
    if (current) for (const listener of this.listeners) listener(current);
  }

  subscribe(listener: (snapshot: TrackSnapshot | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(): Promise<void> {
    handle()?.play();
    return Promise.resolve();
  }

  pause(): Promise<void> {
    handle()?.pause();
    return Promise.resolve();
  }

  next(): Promise<void> {
    handle()?.next();
    return Promise.resolve();
  }

  previous(): Promise<void> {
    handle()?.previous();
    return Promise.resolve();
  }

  seek(seconds: number): Promise<boolean> {
    const native = handle();
    if (!native) return Promise.resolve(false);
    return Promise.resolve(native.seek(seconds) === true);
  }

  openSource(options?: { floating?: boolean }): Promise<void> {
    // El tocadiscos pasa un booleano y la consola un objeto; se aceptan los dos
    // porque confundirlos aquí significa abrir Spotify sin ventana flotante y
    // sin ningún error visible.
    const raw: unknown = options;
    const floating =
      raw === true ||
      (typeof raw === 'object' && raw !== null && (raw as { floating?: boolean }).floating === true);
    handle()?.openSource(floating);
    return Promise.resolve();
  }

  /** Atajo para la pantalla de permisos: la consola lo ofrece si hace falta. */
  requestNotificationAccess(): void {
    handle()?.openNotificationSettings();
  }

  notificationAccess(): boolean {
    return handle()?.notificationAccess() === true;
  }

  dispose(): void {
    this.listeners.clear();
    delete host().__spindisk;
  }
}

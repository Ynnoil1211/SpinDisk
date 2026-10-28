/**
 * Contrato único entre el motor visual y cualquier fuente de datos.
 *
 * El navegador lo alimenta con `SandboxBridge` (menú F2) y la tablet con
 * `AndroidBridge` (MediaSession vía Capacitor). El render nunca sabe de dónde
 * vienen los datos: sólo consume `TrackSnapshot`.
 */

export type SourceApp = 'spotify' | 'youtube-music' | 'youtube' | 'local' | 'unknown';

export interface TrackSnapshot {
  /** Identificador estable de la pista, si la fuente lo ofrece. */
  id?: string;
  title: string;
  artist: string;
  album?: string;
  /** Portada en ~600px. Puede venir de la notificación de Android. */
  coverUrl?: string;
  /** Segundo actual de reproducción. */
  currentTime: number;
  /** Duración total en segundos. 0 si se desconoce. */
  duration: number;
  isPlaying: boolean;
  /** false en Spotify Free: sin retroceso ni seek manual. */
  canSeek: boolean;
  source: SourceApp;
}

export interface PlayerBridge {
  readonly kind: 'sandbox' | 'android';
  connect(): Promise<void>;
  /** Devuelve la función para cancelar la suscripción. */
  subscribe(listener: (snapshot: TrackSnapshot | null) => void): () => void;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(seconds: number): Promise<boolean>;
  getVolume?(): number;
  setVolume?(level: number): boolean;
  /** Abre la app de origen (Spotify / YouTube). `floating` pide ventana flotante. */
  openSource(options?: { floating?: boolean }): Promise<void>;
}

export type DiscTexture = 'marble' | 'black' | 'cream' | 'glass' | 'smoke' | 'terracotta' | 'sage';

export type DeskTexture = 'album' | 'wood' | 'sand' | 'slate' | 'sage';

export interface Preferences {
  discTexture: DiscTexture;
  deskTexture: DeskTexture;
  rpm: 33 | 45;
  /** 0..1 volumen del foley (estática + mecánica). */
  foley: number;
  /**
   * Imprimir la hora en un papelito sobre la mesa mientras hay música. El reloj
   * de reposo (la hora en el fajín de la funda) no depende de esto: entra solo
   * tras un minuto en pausa.
   */
  clockWhilePlaying: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  discTexture: 'marble',
  deskTexture: 'album',
  rpm: 33,
  foley: 0.55,
  clockWhilePlaying: false,
};

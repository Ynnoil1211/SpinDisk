/** Persistencia mínima de preferencias en localStorage. */

import { DEFAULT_PREFERENCES, type DeskTexture, type DiscTexture, type Preferences } from './types.js';

const KEY = 'spindisk.prefs.v1';

const isDiscTexture = (value: unknown): value is DiscTexture =>
  value === 'marble' ||
  value === 'black' ||
  value === 'cream' ||
  value === 'glass' ||
  value === 'smoke' ||
  value === 'terracotta' ||
  value === 'sage';

const isDeskTexture = (value: unknown): value is DeskTexture =>
  value === 'album' ||
  value === 'wood' ||
  value === 'sand' ||
  value === 'slate' ||
  value === 'sage';

export const loadPreferences = (): Preferences => {
  const prefs: Preferences = { ...DEFAULT_PREFERENCES };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return prefs;
    const saved = JSON.parse(raw) as Partial<Preferences>;
    if (isDiscTexture(saved.discTexture)) prefs.discTexture = saved.discTexture;
    if (isDeskTexture(saved.deskTexture)) prefs.deskTexture = saved.deskTexture;
    if (saved.rpm === 33 || saved.rpm === 45) prefs.rpm = saved.rpm;
    if (typeof saved.foley === 'number' && Number.isFinite(saved.foley)) {
      prefs.foley = Math.min(1, Math.max(0, saved.foley));
    }
    if (typeof saved.clockWhilePlaying === 'boolean') {
      prefs.clockWhilePlaying = saved.clockWhilePlaying;
    }
  } catch {
    // localStorage puede fallar en modo privado: seguimos con los valores por defecto.
  }
  return prefs;
};

export const savePreferences = (prefs: Preferences): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Silencioso a propósito: la app funciona igual sin persistencia.
  }
};

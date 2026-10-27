// Las dos zonas que abren la consola: el borde inferior y la esquina superior
// izquierda.
//
// Se miden en píxeles de pantalla, no en el espacio de diseño. El motor dibuja
// en un lienzo de 1280×800 que se escala y, en pantallas más anchas que 16:10,
// se recorta por arriba y por abajo: el borde del diseño puede quedar fuera de
// la pantalla, y entonces una prueba en coordenadas de diseño nunca se cumple.
// Pasó de verdad: en un móvil tumbado el panel dejó de abrirse porque el borde
// inferior visible estaba en y≈739 del diseño y la zona empezaba en y=770.

/** Franja inferior mínima que abre la consola, en píxeles de pantalla. */
export const EDGE_BAND = 38;

/** Franja máxima: más que esto se comería media mesa en pantallas altas. */
export const EDGE_BAND_MAX = 64;

/** Lado de la esquina superior izquierda que también la abre. */
export const CORNER = 88;

/**
 * Franja inferior para una pantalla de `height` píxeles: 6 % del alto, acotada
 * entre `EDGE_BAND` y `EDGE_BAND_MAX`. En la tablet (800 px) son 48 px; en un
 * móvil tumbado (393 px) se queda en el mínimo.
 */
export const edgeBand = (height: number): number =>
  Math.round(Math.min(EDGE_BAND_MAX, Math.max(EDGE_BAND, height * 0.06)));

export const isPanelEdge = (clientX: number, clientY: number, height: number): boolean =>
  clientY >= height - edgeBand(height) || (clientX <= CORNER && clientY <= CORNER);

/** Qué hace un toque en el lienzo. */
export type TapAction = 'open' | 'close' | 'pass';

/**
 * Decide el toque antes de mirar el disco:
 *
 * - en el borde inferior o la esquina → abre la consola;
 * - sobre la mesa vacía → abre la consola, o la cierra si ya estaba (tocar la
 *   mesa es la forma más evidente de pedir los mandos, y así no hay que atinar
 *   con una franja de 4 px);
 * - sobre el disco, la funda o el brazo → lo de siempre: frenar, girar, arrastrar.
 */
export const decideTap = (edge: boolean, onDesk: boolean, isOpen: boolean): TapAction => {
  if (edge) return isOpen ? 'pass' : 'open';
  if (!onDesk) return 'pass';
  return isOpen ? 'close' : 'open';
};

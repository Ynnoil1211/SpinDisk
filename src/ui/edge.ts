// Las dos zonas que abren la consola: el borde inferior y la esquina superior
// izquierda.
//
// Se miden en píxeles de pantalla, no en el espacio de diseño. El motor dibuja
// en un lienzo de 1280×800 que se escala y, en pantallas más anchas que 16:10,
// se recorta por arriba y por abajo: el borde del diseño puede quedar fuera de
// la pantalla, y entonces una prueba en coordenadas de diseño nunca se cumple.
// Pasó de verdad: en un móvil tumbado el panel dejó de abrirse porque el borde
// inferior visible estaba en y≈739 del diseño y la zona empezaba en y=770.

/** Alto de la franja inferior que abre la consola, en píxeles de pantalla. */
export const EDGE_BAND = 38;

/** Lado de la esquina superior izquierda que también la abre. */
export const CORNER = 88;

export const isPanelEdge = (clientX: number, clientY: number, height: number): boolean =>
  clientY >= height - EDGE_BAND || (clientX <= CORNER && clientY <= CORNER);

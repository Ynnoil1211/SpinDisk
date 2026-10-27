/**
 * Pilas de fuentes del proyecto.
 *
 * El PC tiene Georgia y Segoe UI; la tablet Lenovo no: Android sólo trae
 * Noto Serif y Roboto. Sin nombrarlas explícitamente, el navegador de la
 * tablet caería en la fuente por defecto del sistema y la dirección de arte
 * (etiqueta del disco, liner notes, hora del reloj) cambiaría de golpe.
 * De ahí el orden: primero la fuente "bonita" del PC, luego su equivalente
 * real en Android y, al final, la familia genérica.
 */

/** Serif clásica: galleta, liner notes y la hora del reloj. */
export const SERIF = 'Georgia, "Iowan Old Style", "Noto Serif", "Times New Roman", serif';

/** Sans de interfaz: créditos, datos técnicos y la tarjeta del reloj. */
export const SANS = '"Helvetica Neue", "Segoe UI", Roboto, system-ui, sans-serif';

/** Monoespaciada: datos de catálogo y textos legales de la galleta. */
export const MONO = '"SF Mono", "Cascadia Mono", "Roboto Mono", monospace';

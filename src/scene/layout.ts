/**
 * Geometría del mueble. Un único espacio de diseño (1280×800) que se escala a
 * la pantalla de la tablet; así las proporciones no dependen del dispositivo.
 */

import { clamp } from '../util/math.js';

export const DESIGN = { width: 1280, height: 800 } as const;

export interface Layout {
  sleeve: { cx: number; cy: number; size: number; rotation: number; radius: number };
  disc: {
    cx: number;
    cy: number;
    r: number;
    labelR: number;
    holeR: number;
    /** Centro cuando el disco duerme dentro de la funda. */
    hiddenCx: number;
    /** Centro en modo reloj: asoma un tercio. */
    clockCx: number;
  };
  arm: {
    px: number;
    py: number;
    length: number;
    baseR: number;
    counterweight: number;
    /** Radio del surco exterior e interior sobre el que viaja la aguja. */
    outerR: number;
    innerR: number;
  };
  console: { height: number };
}

export const LAYOUT: Layout = {
  sleeve: {
    cx: 398,
    cy: 406,
    size: 500,
    rotation: -3.2 * (Math.PI / 180),
    radius: 3,
  },
  disc: {
    cx: 800,
    cy: 414,
    r: 258,
    labelR: 86,
    holeR: 6.5,
    /** Centro cuando el disco duerme dentro de la funda. */
    hiddenCx: 390,
    /** Centro en modo reloj: asoma un tercio. */
    clockCx: 560,
  },
  arm: {
    px: 1150,
    py: 250,
    length: 310,
    baseR: 38,
    counterweight: 104,
    /** Radio del surco exterior e interior sobre el que viaja la aguja. */
    outerR: 248,
    innerR: 92,
  },
  console: {
    height: 168,
  },
};

export interface Point {
  x: number;
  y: number;
}

/** Ángulo desde el pivote hacia el centro del plato. */
export const PIVOT_TO_CENTER = Math.atan2(
  LAYOUT.disc.cy - LAYOUT.arm.py,
  LAYOUT.disc.cx - LAYOUT.arm.px,
);

export const PIVOT_DISTANCE = Math.hypot(
  LAYOUT.disc.cx - LAYOUT.arm.px,
  LAYOUT.disc.cy - LAYOUT.arm.py,
);

/** Radio de surco para un progreso 0..1. */
export const progressToRadius = (progress: number): number => {
  const { outerR, innerR } = LAYOUT.arm;
  return outerR + (innerR - outerR) * clamp(progress, 0, 1);
};

export const radiusToProgress = (radius: number): number => {
  const { outerR, innerR } = LAYOUT.arm;
  return clamp((outerR - radius) / (outerR - innerR), 0, 1);
};

/** Ángulo del brazo (rad) que posa la aguja a un radio dado. */
export const armAngleForRadius = (radius: number): number => {
  const L = LAYOUT.arm.length;
  const d = PIVOT_DISTANCE;
  const cos = (d * d + L * L - radius * radius) / (2 * d * L);
  const theta = Math.acos(clamp(cos, -1, 1));
  return PIVOT_TO_CENTER - theta;
};

export const armAngleForProgress = (progress: number): number =>
  armAngleForRadius(progressToRadius(progress));

export const radiusForArmAngle = (angle: number): number => {
  const L = LAYOUT.arm.length;
  const d = PIVOT_DISTANCE;
  const theta = PIVOT_TO_CENTER - angle;
  const r2 = d * d + L * L - 2 * d * L * Math.cos(theta);
  return Math.sqrt(Math.max(0, r2));
};

export const progressForArmAngle = (angle: number): number =>
  radiusToProgress(radiusForArmAngle(angle));

export const needlePoint = (angle: number, length = LAYOUT.arm.length): Point => ({
  x: LAYOUT.arm.px + Math.cos(angle) * length,
  y: LAYOUT.arm.py + Math.sin(angle) * length,
});

/**
 * Límites reales del recorrido. Ojo con el signo: cuanto más cerca del centro,
 * mayor es el ángulo (el surco interior queda "más allá" en el arco).
 */
export const ARM_ANGLE_AT_EDGE = armAngleForRadius(LAYOUT.arm.outerR);
export const ARM_ANGLE_AT_LABEL = armAngleForRadius(LAYOUT.arm.innerR);

/** El brazo en reposo descansa fuera del disco, junto a su soporte. */
export const REST_ANGLE = ARM_ANGLE_AT_EDGE - 0.30;

export type HitTarget = 'disc' | 'label' | 'sleeve' | 'arm' | 'none';

/** Distancia de un punto al segmento pivote→aguja. */
const distanceToArm = (x: number, y: number, angle: number): number => {
  const tip = needlePoint(angle);
  const ax = LAYOUT.arm.px;
  const ay = LAYOUT.arm.py;
  const vx = tip.x - ax;
  const vy = tip.y - ay;
  const wx = x - ax;
  const wy = y - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
};

export const hitTest = (x: number, y: number, armAngle: number): HitTarget => {
  if (distanceToArm(x, y, armAngle) < 26) return 'arm';
  const dx = x - LAYOUT.disc.cx;
  const dy = y - LAYOUT.disc.cy;
  const dist = Math.hypot(dx, dy);
  if (dist < LAYOUT.disc.labelR) return 'label';
  if (dist < LAYOUT.disc.r) return 'disc';

  // Funda: rectángulo rotado.
  const cos = Math.cos(-LAYOUT.sleeve.rotation);
  const sin = Math.sin(-LAYOUT.sleeve.rotation);
  const rx = (x - LAYOUT.sleeve.cx) * cos - (y - LAYOUT.sleeve.cy) * sin;
  const ry = (x - LAYOUT.sleeve.cx) * sin + (y - LAYOUT.sleeve.cy) * cos;
  const half = LAYOUT.sleeve.size / 2;
  if (Math.abs(rx) < half && Math.abs(ry) < half) return 'sleeve';
  return 'none';
};

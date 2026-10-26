/** Primitivas de dibujo compartidas. Nada de librerías: Canvas 2D puro. */

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export const makeSurface = (width: number, height: number, dpr = 1): Surface => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
};

export const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

/** Dibuja una imagen cubriendo el rectángulo (center-crop). */
export const drawCoverFit = (
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
): void => {
  const iw = 'naturalWidth' in img ? img.naturalWidth : (img as HTMLCanvasElement).width;
  const ih = 'naturalHeight' in img ? img.naturalHeight : (img as HTMLCanvasElement).height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
};

/** Sombra suave pre-renderizada: se dibuja como sprite, no cuesta blur por frame. */
export const makeShadowSprite = (
  w: number,
  h: number,
  radius: number,
  blur: number,
  color: string,
  spread = 0,
): HTMLCanvasElement => {
  const pad = Math.ceil(blur * 2 + spread);
  const surface = makeSurface(w + pad * 2, h + pad * 2);
  const { ctx } = surface;
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = color;
  roundRectPath(ctx, pad - spread, pad - spread, w + spread * 2, h + spread * 2, radius + spread);
  ctx.fill();
  return surface.canvas;
};

/** Grano de papel: una sola tesela repetida, imperceptible pero da materialidad. */
export const makeGrainTile = (size: number, strength: number, seed = 7): HTMLCanvasElement => {
  const surface = makeSurface(size, size);
  const { ctx } = surface;
  const image = ctx.createImageData(size, size);
  let s = seed >>> 0;
  for (let i = 0; i < image.data.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = (s >>> 24) / 255;
    const light = v > 0.5;
    image.data[i] = light ? 255 : 24;
    image.data[i + 1] = light ? 250 : 18;
    image.data[i + 2] = light ? 240 : 12;
    image.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 255 * strength);
  }
  ctx.putImageData(image, 0, 0);
  return surface.canvas;
};

/** Texto curvo, letra por letra, alrededor de un centro. */
export const drawCurvedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  centerAngle: number,
  options: {
    font: string;
    color: string;
    letterSpacing?: number;
    /** true: se lee desde dentro del círculo (texto en la mitad inferior). */
    flip?: boolean;
  },
): void => {
  const { font, color, letterSpacing = 0, flip = false } = options;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + letterSpacing);
  const total = widths.reduce((a, b) => a + b, 0);
  const totalAngle = total / radius;

  let angle = centerAngle - totalAngle / 2;
  for (let i = 0; i < chars.length; i++) {
    const step = widths[i] / radius;
    const a = angle + step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    angle += step;
  }
  ctx.restore();
};

/** Recorta un texto a un número máximo de líneas, con elipsis. */
export const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
};

/** Ruido de valor 2D con interpolación suave, base del mármol. */
const makeNoise2D = (seed: number) => {
  const size = 256;
  const table = new Float32Array(size * size);
  let s = seed >>> 0;
  for (let i = 0; i < table.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    table[i] = (s >>> 8) / 16777216;
  }
  const at = (x: number, y: number): number => table[(y & 255) * 256 + (x & 255)];
  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
};

export interface MarbleColors {
  base: string;
  light: string;
  dark: string;
  vein: string;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const cssToRgb = (css: string): Rgb => {
  const match = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i.exec(css);
  if (match) {
    const h = parseFloat(match[1]) / 360;
    const s = parseFloat(match[2]) / 100;
    const l = parseFloat(match[3]) / 100;
    const hue2rgb = (p: number, q: number, t: number): number => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hue2rgb(p, q, h + 1 / 3) * 255,
      g: hue2rgb(p, q, h) * 255,
      b: hue2rgb(p, q, h - 1 / 3) * 255,
    };
  }
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(css);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return { r: 200, g: 190, b: 170 };
};

/**
 * Textura de resina marmoleada translúcida, generada por dominio deformado.
 * Se cachea: sólo se recalcula al cambiar portada o textura.
 */
export const makeMarbleTexture = (
  colors: MarbleColors,
  size: number,
  seed: number,
  kind: 'marble' | 'black' | 'cream' | 'glass',
): HTMLCanvasElement => {
  const surface = makeSurface(size, size);
  const { ctx } = surface;
  const image = ctx.createImageData(size, size);
  const data = image.data;

  const base = cssToRgb(colors.base);
  const light = cssToRgb(colors.light);
  const dark = cssToRgb(colors.dark);
  const vein = cssToRgb(colors.vein);
  const noise = makeNoise2D(seed);

  const fbm = (x: number, y: number): number => {
    let sum = 0;
    let amp = 0.55;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += noise(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  };

  const half = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half;
      const ny = (py - half) / half;
      const r = Math.sqrt(nx * nx + ny * ny);
      const angle = Math.atan2(ny, nx);
      const u = nx * 2.2 + 9.3;
      const v = ny * 2.2 + 4.7;

      let r0: number;
      let g0: number;
      let b0: number;

      if (kind === 'black') {
        const sheen = Math.max(0, 1 - Math.abs(r - 0.62) * 9) * 0.5;
        const fine = fbm(px / 12, py / 12) * 0.10;
        const value = 12 + sheen * 46 + fine * 60;
        r0 = value;
        g0 = value * 0.99;
        b0 = value * 0.97;
      } else if (kind === 'cream') {
        const mottle = fbm(px / 26, py / 26);
        const fleck = fbm(px / 4, py / 4);
        const t = mottle * 0.7 + fleck * 0.3;
        r0 = 232 + (t - 0.5) * 34;
        g0 = 220 + (t - 0.5) * 40;
        b0 = 196 + (t - 0.5) * 46;
      } else {
        const warpA = fbm(u * 0.9 + 3.1, v * 0.9 - 1.7);
        const warpB = fbm(u * 0.9 - 2.4, v * 0.9 + 6.2);
        const n = fbm(u + warpA * 2.4, v + warpB * 2.4);
        const band = Math.sin(n * 9.5 + Math.sin(n * 2.6) * 2.1 + r * 1.4);
        const t = Math.min(1, Math.max(0, (band + 1) * 0.5));
        const contrast = kind === 'glass' ? 0.55 : 1;
        const tt = 0.5 + (t - 0.5) * contrast;

        let cr: number;
        let cg: number;
        let cb: number;
        if (tt < 0.42) {
          const k = tt / 0.42;
          cr = dark.r + (base.r - dark.r) * k;
          cg = dark.g + (base.g - dark.g) * k;
          cb = dark.b + (base.b - dark.b) * k;
        } else if (tt < 0.78) {
          const k = (tt - 0.42) / 0.36;
          cr = base.r + (vein.r - base.r) * k;
          cg = base.g + (vein.g - base.g) * k;
          cb = base.b + (vein.b - base.b) * k;
        } else {
          const k = (tt - 0.78) / 0.22;
          cr = vein.r + (light.r - vein.r) * k;
          cg = vein.g + (light.g - vein.g) * k;
          cb = vein.b + (light.b - vein.b) * k;
        }

        const speckle = (fbm(px / 2.6, py / 2.6) - 0.5) * 9;
        const rim = Math.max(0, 1 - Math.abs(r - 0.995) * 40) * 12;
        r0 = cr + speckle + rim;
        g0 = cg + speckle + rim;
        b0 = cb + speckle + rim;
      }

      const index = (py * size + px) * 4;
      data[index] = r0;
      data[index + 1] = g0;
      data[index + 2] = b0;
      data[index + 3] = 255;
      // Las vetas se ensanchan en el ángulo: rompe la simetría perfecta.
      void angle;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Micro-surcos: anillos concéntricos muy tenues.
  ctx.save();
  ctx.translate(half, half);
  const rings = kind === 'black' ? 120 : 88;
  for (let i = 0; i < rings; i++) {
    const rr = (i / rings) * half * 0.97;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.restore();

  return surface.canvas;
};

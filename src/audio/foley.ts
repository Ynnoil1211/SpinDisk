/**
 * Motor Foley: 100% sintetizado en WebAudio, cero archivos de audio.
 *
 * - Chisporroteo de polvo en bucle (ruido filtrado + pops aleatorios).
 * - Caída de aguja: golpe grave corto + click de contacto.
 * - Interruptor del motor al arrancar / frenar.
 * - Roce del brazo al moverse.
 *
 * Todo se mezcla por encima de Spotify sin tocar su audio.
 */

import { clamp } from '../util/math.js';

/**
 * Techo absoluto del motor Foley.
 *
 * El Foley se suma *por encima* de Spotify, así que su mezcla completa tiene que
 * quedar muy por debajo de la voz: con el deslizador al 100 % el pico teórico es
 * 0,4 × (0,5 de estática + 0,55 de caída de aguja) ≈ 0,42, lejos del recorte y
 * con margen para no tapar la música.
 */
const MASTER_CEILING = 0.4;

export class Foley {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crackleGain: GainNode | null = null;
  private crackleSource: AudioBufferSourceNode | null = null;
  private crackleBuffer: AudioBuffer | null = null;
  private volume = 0.55;
  private enabled = true;

  /** Debe llamarse desde un gesto del usuario (política de autoplay). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * MASTER_CEILING;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume * MASTER_CEILING, this.ctx.currentTime, 0.05);
    }
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!this.crackleGain || !this.ctx) return;
    this.crackleGain.gain.setTargetAtTime(value ? 0.5 : 0, this.ctx.currentTime, 0.08);
  }

  /** Enciende o apaga el bucle de estática (aguja sobre el disco). */
  crackle(on: boolean): void {
    if (!this.ctx || !this.master) return;
    if (!this.crackleBuffer) this.crackleBuffer = this.buildCrackleBuffer(this.ctx);
    if (!this.crackleSource) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.crackleBuffer;
      source.loop = true;

      const highpass = this.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 420;
      highpass.Q.value = 0.6;

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 5200;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      source.connect(highpass).connect(lowpass).connect(gain).connect(this.master);
      source.start();
      this.crackleSource = source;
      this.crackleGain = gain;
    }
    const target = on && this.enabled ? 0.5 : 0;
    this.crackleGain?.gain.setTargetAtTime(target, this.ctx.currentTime, on ? 0.35 : 0.18);
  }

  /** Golpe de la aguja sobre el surco inicial. */
  needleDrop(intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.18);
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(0.0001, now);
    thump.gain.exponentialRampToValueAtTime(0.55 * intensity, now + 0.012);
    thump.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(thump).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.4);

    this.noiseBurst(0.035, 900, 0.3 * intensity, 0.09);
  }

  /** Interruptor mecánico del motor. */
  switchClick(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(on ? 180 : 140, now);
    osc.frequency.exponentialRampToValueAtTime(on ? 70 : 58, now + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);

    this.noiseBurst(0.004, 2600, 0.16, 0.02);
  }

  /** Roce suave del brazo al levantarse o posarse. */
  armTouch(): void {
    this.noiseBurst(0.16, 1500, 0.045, 0.05);
  }

  private noiseBurst(duration: number, cutoff: number, level: number, attack: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private buildCrackleBuffer(ctx: AudioContext): AudioBuffer {
    const seconds = 4;
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);

    // Lecho de ruido de superficie.
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.86 + white * 0.14;
      data[i] = last * 0.16;
    }

    // Pops e impurezas: densidad alta, amplitudes irregulares.
    const pops = Math.floor(seconds * 55);
    for (let p = 0; p < pops; p++) {
      const start = Math.floor(Math.random() * (data.length - 400));
      const amp = 0.12 + Math.pow(Math.random(), 3) * 0.75;
      const decay = 40 + Math.random() * 220;
      const polarity = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 380 && start + i < data.length; i++) {
        data[start + i] += polarity * amp * Math.exp(-i / decay) * (Math.random() * 0.7 + 0.3);
      }
    }

    // Un "scuff" largo ocasional, como un rasguño que pasa bajo la aguja.
    for (let s = 0; s < 3; s++) {
      const start = Math.floor(Math.random() * (data.length - rate * 0.2));
      const length = Math.floor(rate * (0.05 + Math.random() * 0.12));
      for (let i = 0; i < length; i++) {
        const envelope = Math.sin((i / length) * Math.PI);
        data[start + i] += (Math.random() * 2 - 1) * 0.12 * envelope;
      }
    }

    // Los pops se suman y superan la unidad; se normaliza para que el bucle nunca
    // recorte por sí mismo. El nivel final lo decide el mezclador.
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const scale = 0.95 / peak;
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }

    return buffer;
  }
}

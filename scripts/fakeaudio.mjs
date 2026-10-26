// AudioContext falso para revisar el motor Foley sin oídos ni navegador.
//
// No reproduce nada: registra los nodos y las automatizaciones que la app pide,
// para poder afirmar "la caída de aguja es un seno de 96 a 44 Hz" o "el
// chisporroteo nunca pasa de 0,2 de amplitud" con un número, no con una opinión.
//
//   import { installAudio, audio } from './fakeaudio.mjs';

/** Un AudioParam que recuerda cada automatización, como el de verdad pero mudo. */
class FakeParam {
  constructor(value) {
    this.value = value;
    this.target = undefined;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'exp', value, time });
    return this;
  }

  setTargetAtTime(value, time, tau) {
    this.target = value;
    this.events.push({ type: 'target', value, time, tau });
    return this;
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancel', time });
    return this;
  }

  get last() {
    return this.events[this.events.length - 1];
  }

  /** El último "hacia dónde voy": destino de una rampa o de un setTarget. */
  get destination() {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event.type === 'target' || event.type === 'set') return event.value;
    }
    return this.value;
  }
}

class FakeNode {
  constructor(kind, ctx) {
    this.kind = kind;
    this.ctx = ctx;
    this.outputs = [];
    ctx.nodes.push(this);
  }

  connect(destination) {
    this.outputs.push(destination);
    return destination;
  }

  disconnect() {
    this.outputs.length = 0;
  }

  /** Sigue la cadena de conexiones y dice si llega al altavoz. */
  reachesDestination(seen = new Set()) {
    if (this.kind === 'destination') return true;
    if (seen.has(this)) return false;
    seen.add(this);
    return this.outputs.some((node) => node && node.reachesDestination(seen));
  }
}

class FakeGain extends FakeNode {
  constructor(ctx) {
    super('gain', ctx);
    this.gain = new FakeParam(1);
  }
}

class FakeOscillator extends FakeNode {
  constructor(ctx) {
    super('oscillator', ctx);
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.started = null;
    this.stopped = null;
  }

  start(time = 0) {
    this.started = time;
  }

  stop(time = 0) {
    this.stopped = time;
  }
}

class FakeFilter extends FakeNode {
  constructor(ctx) {
    super('filter', ctx);
    this.type = 'lowpass';
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
  }
}

class FakeBufferSource extends FakeNode {
  constructor(ctx) {
    super('source', ctx);
    this.buffer = null;
    this.loop = false;
    this.started = null;
    this.stopped = null;
  }

  start(time = 0) {
    this.started = time;
  }

  stop(time = 0) {
    this.stopped = time;
  }
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 44_100;
    this.currentTime = 0;
    this.state = 'suspended';
    this.nodes = [];
    this.destination = new FakeNode('destination', this);
    this.resumed = 0;
  }

  resume() {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  createGain() {
    return new FakeGain(this);
  }

  createOscillator() {
    return new FakeOscillator(this);
  }

  createBiquadFilter() {
    return new FakeFilter(this);
  }

  createBufferSource() {
    return new FakeBufferSource(this);
  }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      duration: length / sampleRate,
      getChannelData: (channel) => data[channel],
    };
  }

  // ------------------------------------------------------------- consultas
  get contexts() {
    return audio.contexts;
  }

  of(kind) {
    return this.nodes.filter((node) => node.kind === kind);
  }

  /** Pico absoluto de un AudioBuffer, para hablar de niveles sin oírlos. */
  static peak(buffer) {
    const data = buffer.getChannelData(0);
    let max = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > max) max = value;
    }
    return max;
  }
}

/** Estado compartido: todos los contextos creados, para inspeccionarlos. */
export const audio = {
  contexts: [],
  reset() {
    this.contexts.length = 0;
  },
  get last() {
    return this.contexts[this.contexts.length - 1];
  },
};

/** Publica el AudioContext falso en `window` (llamar después de installDom). */
export const installAudio = () => {
  globalThis.window.AudioContext = class TrackedAudioContext extends FakeAudioContext {
    constructor() {
      super();
      audio.contexts.push(this);
    }
  };
  return audio;
};

export { FakeAudioContext };

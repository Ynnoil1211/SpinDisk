/**
 * DOM mínimo para probar la capa de interfaz sin navegador.
 *
 * En este PC Chrome no puede arrancar (su multiproceso recibe acceso denegado),
 * así que la consola y el panel de pruebas no se pueden ver. Lo que sí se puede
 * hacer es ejecutar su código real contra un árbol construido a partir del
 * `index.html` verdadero: así un `#id` mal escrito o un selector que ya no
 * existe falla aquí, en vez de fallar en la tablet.
 *
 * No pretende ser un navegador: cubre lo que usan `src/ui/*.ts` y `src/main.ts`.
 */

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline',
  'polygon', 'ellipse', 'stop', 'use',
]);

const ATTR_RE = /([:@\w-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)'|\s*=\s*([^\s"'>]+))?/g;

/** Elemento del mini-DOM. */
export class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.style = {};
    this._text = '';
    this.value = this.attrs.get('value') ?? '';
    this.hidden = this.attrs.has('hidden');
    this.focused = false;
  }

  get tag() {
    return this.tagName.toLowerCase();
  }

  get id() {
    return this.attrs.get('id') ?? '';
  }

  get title() {
    return this.attrs.get('title') ?? '';
  }

  set title(value) {
    this.attrs.set('title', String(value));
  }

  get className() {
    return this.attrs.get('class') ?? '';
  }

  set className(value) {
    this.attrs.set('class', String(value ?? ''));
  }

  get classList() {
    const self = this;
    const read = () => (self.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
    const write = (list) => self.attrs.set('class', list.join(' '));
    return {
      add(...names) {
        const list = read();
        for (const name of names) if (!list.includes(name)) list.push(name);
        write(list);
      },
      remove(...names) {
        write(read().filter((name) => !names.includes(name)));
      },
      contains(name) {
        return read().includes(name);
      },
      toggle(name, force) {
        const has = read().includes(name);
        const next = force === undefined ? !has : Boolean(force);
        if (next && !has) this.add(name);
        if (!next && has) this.remove(name);
        return next;
      },
    };
  }

  get dataset() {
    const out = {};
    for (const [key, value] of this.attrs) {
      if (!key.startsWith('data-')) continue;
      const camel = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[camel] = value;
    }
    return out;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent).join('').trim();
  }

  set textContent(value) {
    this.children = [];
    this._text = String(value ?? '');
  }

  get innerHTML() {
    return this.children.map((child) => child.outerHTML ?? '').join('');
  }

  set innerHTML(html) {
    this.children = [];
    this._text = '';
    const nodes = parseFragment(String(html ?? ''));
    for (const node of nodes) this.append(node);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      if (typeof node === 'string') {
        this._text += node;
        continue;
      }
      node.parent = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  removeChild(node) {
    this.children = this.children.filter((child) => child !== node);
    if (node) node.parent = null;
    return node;
  }

  insertBefore(node, reference) {
    const index = this.children.indexOf(reference);
    if (index === -1) return this.appendChild(node);
    node.parent = this;
    this.children.splice(index, 0, node);
    return node;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === 'hidden') this.hidden = true;
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
    // En el navegador `hidden` es una propiedad reflejada: quitar el atributo
    // la apaga. Si el banco no lo imita, una comprobación de visibilidad miente.
    if (name === 'hidden') this.hidden = false;
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }

  dispatch(type, extra = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...extra,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    // Burbuja sencilla hacia los padres.
    if (!event._stopped && this.parent) this.parent.dispatch(type, extra);
    return event;
  }

  focus() {
    if (document.activeElement && document.activeElement !== this) {
      document.activeElement.focused = false;
    }
    this.focused = true;
    document.activeElement = this;
    this.dispatch('focus');
  }

  blur() {
    this.focused = false;
    if (document.activeElement === this) document.activeElement = null;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parent;
    }
    return null;
  }

  matches(selector) {
    return selector.split(',').some((part) => matchesChain(this, part.trim()));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesChain(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    if (parts.length > 1) {
      // `matchesChain` ya resuelve los antepasados; el recorrido basta.
      return out;
    }
    return out;
  }
}

function parseSimple(part) {
  const m = /^([a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/.exec(part);
  if (!m) return null;
  const attrSpec = m[3] ? m[3].match(/\[[^\]]+\]/g) ?? [] : [];
  return {
    tag: m[1] ? m[1].toLowerCase() : null,
    classes: (m[2].match(/\.([\w-]+)/g) ?? []).map((s) => s.slice(1)),
    ids: (m[2].match(/#([\w-]+)/g) ?? []).map((s) => s.slice(1)),
    attrs: attrSpec.map((raw) => {
      const inner = raw.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) return { name: inner, value: null };
      return {
        name: inner.slice(0, eq).trim(),
        value: inner.slice(eq + 1).trim().replace(/^["']|["']$/g, ''),
      };
    }),
  };
}

function matchSimple(node, simple) {
  if (simple.tag && node.tag !== simple.tag) return false;
  const classes = node.classList;
  for (const name of simple.classes) if (!classes.contains(name)) return false;
  for (const id of simple.ids) if (node.id !== id) return false;
  for (const { name, value } of simple.attrs) {
    if (!node.hasAttribute(name)) return false;
    if (value !== null && node.getAttribute(name) !== value) return false;
  }
  return true;
}

function matchesChain(node, selector) {
  const parts = selector.trim().split(/\s+(?![^\[]*\])/).map(parseSimple).filter(Boolean);
  if (parts.length === 0) return false;
  const last = parts[parts.length - 1];
  if (!matchSimple(node, last)) return false;
  let index = parts.length - 2;
  let current = node.parent;
  while (index >= 0) {
    let found = false;
    while (current) {
      if (matchSimple(current, parts[index])) {
        found = true;
        current = current.parent;
        break;
      }
      current = current.parent;
    }
    if (!found) return false;
    index -= 1;
  }
  return true;
}

/** Convierte un trozo de HTML en nodos. */
export function parseFragment(html) {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const root = new El('fragment');
  const stack = [root];
  let index = 0;
  while (index < clean.length) {
    const lt = clean.indexOf('<', index);
    if (lt === -1) {
      const text = clean.slice(index);
      if (text) stack[stack.length - 1].append(decodeText(text));
      break;
    }
    if (lt > index) {
      const text = clean.slice(index, lt);
      if (text.trim()) stack[stack.length - 1].append(decodeText(text));
    }
    const gt = clean.indexOf('>', lt);
    if (gt === -1) break;
    const raw = clean.slice(lt + 1, gt).trim();
    index = gt + 1;
    if (!raw) continue;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const space = body.search(/\s/);
    const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
    const attrs = {};
    if (space !== -1) {
      const rest = body.slice(space);
      ATTR_RE.lastIndex = 0;
      let m;
      while ((m = ATTR_RE.exec(rest))) {
        const key = m[1];
        const value = m[2] ?? m[3] ?? m[4] ?? '';
        if (key) attrs[key] = value;
      }
    }
    const node = new El(name, attrs);
    stack[stack.length - 1].append(node);
    if (!selfClosing && !VOID.has(name)) stack.push(node);
  }
  return root.children.slice();
}

function decodeText(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Reloj y temporizadores controlados a mano. */
export function createClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map();

  const setTimeoutFn = (fn, delay = 0, ...args) => {
    const id = seq++;
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn, args });
    return id;
  };
  const clearTimeoutFn = (id) => {
    timers.delete(id);
  };
  const advance = (ms) => {
    const target = now + ms;
    for (;;) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.at > target) continue;
        if (!next || timer.at < next[1].at) next = [id, timer];
      }
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn(...next[1].args);
    }
    now = target;
  };

  return {
    get now() {
      return now;
    },
    get pending() {
      return timers.size;
    },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    advance,
  };
}

/** Instala `document`/`window` globales a partir de un HTML. */
export function installDom(html) {
  const clock = createClock();
  const nodes = parseFragment(html);
  const documentElement = nodes.find((node) => node.tag === 'html') ?? new El('html');
  const findTag = (node, tag) => {
    if (node.tag === tag) return node;
    for (const child of node.children) {
      const hit = findTag(child, tag);
      if (hit) return hit;
    }
    return null;
  };
  const body = findTag(documentElement, 'body') ?? new El('body');
  const all = [];
  const collect = (node) => {
    all.push(node);
    for (const child of node.children) collect(child);
  };
  body.parent = null;
  collect(body);

  const document = {
    body,
    documentElement,
    activeElement: null,
    hidden: false,
    getElementById(id) {
      return all.find((node) => node.id === id) ?? null;
    },
    createElement(tag) {
      return new El(tag);
    },
    createTextNode(text) {
      const node = new El('#text');
      node.textContent = text;
      return node;
    },
    querySelector(selector) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const window = {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setTimeout,
    clearInterval: clock.clearTimeout,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { vibrate() {} },
    location: { search: '' },
  };

  globalThis.document = document;
  globalThis.window = window;
  if (!globalThis.navigator) globalThis.navigator = window.navigator;
  if (!globalThis.location) globalThis.location = window.location;

  return { document, window, body, clock, all };
}

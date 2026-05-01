// Polyfill for localStorage / sessionStorage during static export build.
// Some SE2 internals (and wallet libs) touch storage at module-import time,
// which crashes Next.js' static export under Node 20+. We give them a no-op.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: key => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: i => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

if (typeof globalThis.sessionStorage === "undefined") {
  const sstore = new Map();
  globalThis.sessionStorage = {
    getItem: key => (sstore.has(key) ? sstore.get(key) : null),
    setItem: (key, value) => {
      sstore.set(String(key), String(value));
    },
    removeItem: key => {
      sstore.delete(key);
    },
    clear: () => {
      sstore.clear();
    },
    key: i => Array.from(sstore.keys())[i] ?? null,
    get length() {
      return sstore.size;
    },
  };
}

if (typeof globalThis.document === "undefined") {
  const noop = () => {};
  // Each fake element gets its own `data` and `textContent` strings (used by
  // goober / react-hot-toast at module-load time during static export).
  const makeFakeElement = () => {
    const el = {
      style: {},
      data: "",
      textContent: "",
      innerHTML: "",
      tagName: "DIV",
      setAttribute: noop,
      getAttribute: () => null,
      removeAttribute: noop,
      appendChild: child => {
        if (child) el.children.push(child);
        return child;
      },
      removeChild: noop,
      insertBefore: noop,
      addEventListener: noop,
      removeEventListener: noop,
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      contains: () => false,
      querySelector: () => null,
      querySelectorAll: () => [],
      children: [],
    };
    return el;
  };
  const head = makeFakeElement();
  const body = makeFakeElement();
  const docEl = makeFakeElement();
  globalThis.document = {
    documentElement: docEl,
    head,
    body,
    createElement: () => makeFakeElement(),
    createElementNS: () => makeFakeElement(),
    createTextNode: data => {
      const el = makeFakeElement();
      el.data = String(data ?? "");
      return el;
    },
    getElementById: () => null,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    cookie: "",
  };
}

// Intentionally do NOT define `window` here. Several CSS-in-JS libraries
// (notably goober via react-hot-toast) gate browser-only code on
// `typeof window === "object"` and crash when given a half-built window
// during static export. Leaving `window` undefined sends them down their
// SSR-safe fallback path. localStorage / sessionStorage above are global
// polyfills the wallet libs read directly via `globalThis.localStorage`.

if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = { userAgent: "node" };
}

// 2026-10-30: Panel passed `cancel: cancelSignIn`, a function that did not exist. Nothing threw until a
// login was pending, then the whole provider card crashed with ReferenceError and vanished from
// Settings > Models ("clicked sign in and card went away"). verify.mjs-style import checks cannot see
// this: the failure only happens when the component RENDERS with that state. So render it here.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const clientSrc = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');

const pendingStatus = {
  signedIn: false,
  plan: { mode: 'signed-out' },
  access: { full: false },
  codex: { available: false },
  extraUsage: { blocked: false, exhausted: null },
  login: { url: 'https://claude.ai/oauth/authorize?x=1', phase: 'waiting-code' },
  canCancelLogin: false,
  error: null,
  busy: false,
};

// minimal React: hooks return the pending state so Panel renders its PendingLogin branch
const fakeReact = {
  // the status state (an object carrying `signedIn`) must come back LOGGED OUT with a login pending,
  // which is the only state in which Panel renders PendingLogin — the state that used to throw
  useState: (init) => {
    const isStatusState = init && typeof init === 'object' && 'signedIn' in init;
    return [isStatusState ? { ...init, ...pendingStatus } : init, () => {}];
  },
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) => ({ type, props, children }),
};
// the bundle reads `location` at factory time (loopback detection)
globalThis.location = { hostname: '192.168.0.100', origin: 'http://192.168.0.100:8085', protocol: 'http:' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let loaded;
const fakeWindow = { __ModuleLoader__: { load: (reg) => { loaded = reg; } } };
new Function('window', clientSrc)(fakeWindow);
// React would call function components; rendering them here is the whole point, otherwise Panel's
// body (where the ReferenceError lived) never runs.
const render = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
const fakeJsxRuntime = {
  jsx: render,
  jsxs: render,
  Fragment: Symbol.for('react.fragment'),
};
const mod = loaded.factory((name) => {
  if (name === 'react') return fakeReact;
  if (name === 'react/jsx-runtime') return fakeJsxRuntime;
  if (name === 'react-dom') return { createPortal: (children) => ({ type: 'portal', children }) };
  // host UI modules (primitives, hosts, stores): any component stand-in renders to null
  return new Proxy({}, { get: () => () => null });
});

// the client calls fetch('/__membership/status'); make it answer with a pending login
globalThis.fetch = async () => ({ ok: true, json: async () => pendingStatus });

const registered = [];
mod.apply({
  get: () => undefined,
  effect: () => () => {},
  slots: {
    inject: (seat, make) => { registered.push({ seat, made: make() }); },
    register: (opts, component) => ({ opts, component }),
  },
});

const cardEntry = registered.find((r) => r.made.opts.name === 'settings.models.provider-card');
assert.ok(cardEntry, 'provider card registered');
const Card = cardEntry.made.component;

// the exact failing situation: the anthropic row, with a login pending
const rendered = Card({ provider: { provider: 'anthropic' } });
assert.ok(rendered, 'card renders for the anthropic provider while a login is pending');
const asText = JSON.stringify(rendered);
assert.match(asText, /Finish sign-in/, 'the paste-the-code UI is rendered');
assert.match(asText, /Open the Claude sign-in page/, 'the sign-in link is offered');

// and it must not render for other providers
assert.equal(Card({ provider: { provider: 'openrouter' } }), null);

// the dock chip path must render too (same useStatus hook)
const dockEntry = registered.find((r) => r.made.opts.name === 'conversation.composer.dock');
const dock = dockEntry.made.component({});
assert.ok(dock, 'dock widget renders with a pending login');

console.log('client-render: provider card and dock render with a pending login (no ReferenceError)');

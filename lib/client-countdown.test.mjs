// 2026-11-13 owner request: when a plan window is used up the dock chip must show the time
// until the reset instead of a flat "100%" ("1d+5:32:59" for the weekly window). A plain
// import check cannot see it, so render the dock widget exactly like React would.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const clientSrc = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');

const t0 = Date.now();
const base = (signedIn, plan) => ({ signedIn, plan, access: { full: false }, codex: { available: false }, extraUsage: { blocked: false, exhausted: null }, login: null, canCancelLogin: false, error: null, busy: false });

// the status object the fake React hands to useStatus(); swapped between scenarios
let status = base(true, {});
const fakeReact = {
  useState: (init) => {
    if (init && typeof init === 'object' && 'signedIn' in init) return [{ ...init, ...status }, () => {}];
    return [init, () => {}];
  },
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) => ({ type, props, children }),
};
globalThis.location = { hostname: '192.168.0.100', origin: 'http://192.168.0.100:8085', protocol: 'http:' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let loaded;
new Function('window', clientSrc)({ __ModuleLoader__: { load: (reg) => { loaded = reg; } } });
const render = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
const mod = loaded.factory((name) => {
  if (name === 'react') return fakeReact;
  if (name === 'react/jsx-runtime') return { jsx: render, jsxs: render, Fragment: Symbol.for('react.fragment') };
  if (name === 'react-dom') return { createPortal: (children) => ({ type: 'portal', children }) };
  return new Proxy({}, { get: () => () => null });
});

globalThis.fetch = async () => ({ ok: true, json: async () => status });
const registered = [];
mod.apply({
  get: () => undefined,
  effect: () => () => {},
  slots: {
    inject: (seat, make) => { registered.push({ seat, made: make() }); },
    register: (opts, component) => ({ opts, component }),
  },
});
const dockEntry = registered.find((r) => r.made.opts.name === 'conversation.composer.dock');
assert.ok(dockEntry, 'dock widget registered');
const dockText = () => JSON.stringify(dockEntry.made.component({}));
const COUNTDOWN = /"[0-9]+:[0-9]{2}:[0-9]{2}"/; // 5-hour shape: 4:07:12
const DAYS = /"[0-9]+d\+[0-9]+:[0-9]{2}:[0-9]{2}"/; // weekly shape: 1d+5:32:59

// both windows used up: countdowns, and no "100%" left in the chip
status = base(true, {
  mode: 'plan',
  fiveHour: { percent: 100, resetsAt: new Date(t0 + ((4 * 60 + 7) * 60 + 12) * 1000).toISOString() },
  sevenDay: { percent: 100, resetsAt: new Date(t0 + ((1 * 24 + 5) * 3600 + 32 * 60 + 59) * 1000).toISOString() },
});
let text = dockText();
assert.match(text, COUNTDOWN, '5-hour window at 100% shows a h:mm:ss countdown');
assert.match(text, DAYS, 'weekly window at 100% shows a d+h:mm:ss countdown');
assert.doesNotMatch(text, /"children":"100%"/, 'the used-up window no longer prints a flat 100%');

// room left: the chip keeps the percentage and shows no countdown
status = base(true, { mode: 'plan', fiveHour: { percent: 27, resetsAt: new Date(t0 + 4 * 3600e3).toISOString() }, sevenDay: { percent: 40, resetsAt: new Date(t0 + 3 * 86400e3).toISOString() } });
text = dockText();
assert.match(text, /27%/, '5-hour window below the limit still shows its percentage');
assert.match(text, /40%/, 'weekly window below the limit still shows its percentage');
assert.doesNotMatch(text, COUNTDOWN, 'no countdown while the windows have room');
assert.doesNotMatch(text, DAYS, 'no weekly countdown while the window has room');

// a reset time that has passed must not print a negative or empty countdown
status = base(true, { mode: 'plan', fiveHour: { percent: 100, resetsAt: new Date(t0 - 60_000).toISOString() }, sevenDay: null });
assert.match(dockText(), /"now"/, 'an elapsed reset time reads "now"');

console.log('client-countdown: used-up windows show the reset countdown instead of 100%');

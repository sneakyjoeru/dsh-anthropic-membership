// Wake-up schedule: validation, due-time math in a real zone, once-per-occurrence, arming, skip/error paths.
import assert from 'node:assert/strict';
import { WAKE_UP_DAYS, dayMatches, dueWakeUps, normalizeWakeUps, runWakeUpTick, zonedParts } from './wake-up.mjs';

const TZ = 'Europe/Tallinn';
// 2026-11-05 is a Thursday; Tallinn is UTC+2 in November -> 08:00 local = 06:00Z
const at = (iso) => Date.parse(iso);

assert.deepEqual(WAKE_UP_DAYS, ['daily', 'workday', 'weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
assert.deepEqual(zonedParts(at('2026-11-05T06:00:30Z'), TZ), { ymd: '2026-11-05', day: 'thu', minutes: 480, seconds: 30 });

// validation
assert.throws(() => normalizeWakeUps([{ id: 'a', time: '24:00', day: 'daily' }]), /time must be HH:MM/);
assert.throws(() => normalizeWakeUps([{ id: 'a', time: '7:00', day: 'daily' }]), /time must be HH:MM/);
assert.throws(() => normalizeWakeUps([{ id: 'a', time: '07:00', day: 'monday' }]), /day must be/);
assert.throws(() => normalizeWakeUps([{ id: 'a', time: '07:00', day: 'daily' }, { id: 'a', time: '08:00', day: 'daily' }]), /duplicate id/);
assert.throws(() => normalizeWakeUps('x'), /expected items/);
const armed = at('2026-11-01T00:00:00Z');
const items = normalizeWakeUps(
  [
    { id: 'd', time: '08:00', day: 'daily' },
    { id: 't', time: '08:00', day: 'thu' },
    { id: 'f', time: '08:00', day: 'fri' },
    { id: 'edge', time: '23:59', day: 'daily' },
  ],
  { now: armed },
);
assert.equal(items[0].updatedAt, armed);
// unchanged rows keep their arming time; a changed row is re-armed
const again = normalizeWakeUps([{ id: 'd', time: '08:00', day: 'daily' }, { id: 't', time: '09:00', day: 'thu' }], { now: armed + 5, previous: items });
assert.equal(again[0].updatedAt, armed);
assert.equal(again[1].updatedAt, armed + 5);

// due: daily + thursday fire on Thursday 08:00 local, friday does not; not before, not after the grace
const ids = (nowMs, runs) => dueWakeUps(items, { nowMs, timeZone: TZ, runs }).map((d) => d.item.id).sort();
assert.deepEqual(ids(at('2026-11-05T05:59:59Z')), []);
assert.deepEqual(ids(at('2026-11-05T06:00:05Z')), ['d', 't']);
assert.deepEqual(ids(at('2026-11-05T06:09:00Z')), ['d', 't']);
assert.deepEqual(ids(at('2026-11-05T06:10:00Z')), []);
assert.deepEqual(ids(at('2026-11-06T06:00:05Z')), ['d', 'f']);
assert.deepEqual(ids(at('2026-11-05T21:59:10Z')), ['edge']);
// once per occurrence
assert.deepEqual(ids(at('2026-11-05T06:01:00Z'), { d: { key: '2026-11-05T08:00' } }), ['t']);
// a row created after today's time waits for the next day
const late = normalizeWakeUps([{ id: 'n', time: '08:00', day: 'daily' }], { now: at('2026-11-05T06:03:00Z') });
assert.deepEqual(dueWakeUps(late, { nowMs: at('2026-11-05T06:04:00Z'), timeZone: TZ }), []);
assert.equal(dueWakeUps(late, { nowMs: at('2026-11-06T06:00:10Z'), timeZone: TZ }).length, 1);

// workday / weekend groups: Thu 2026-11-05 and Fri 11-06 are workdays, Sat 11-07 and Sun 11-08 weekend
const groups = normalizeWakeUps([{ id: 'wd', time: '08:00', day: 'workday' }, { id: 'we', time: '08:00', day: 'weekend' }], { now: armed });
const gids = (nowMs) => dueWakeUps(groups, { nowMs, timeZone: TZ }).map((d) => d.item.id);
assert.deepEqual(gids(at('2026-11-05T06:00:05Z')), ['wd']);
assert.deepEqual(gids(at('2026-11-06T06:00:05Z')), ['wd']);
assert.deepEqual(gids(at('2026-11-07T06:00:05Z')), ['we']);
assert.deepEqual(gids(at('2026-11-08T06:00:05Z')), ['we']);
assert.deepEqual(gids(at('2026-11-09T06:00:05Z')), ['wd']);
assert.equal(dayMatches('weekend', 'mon'), false);
assert.equal(dayMatches('daily', 'sun'), true);

// tick: one ping for two due rows, runs recorded, second tick does nothing
function memStore(state) {
  return { state, read: () => state, recordRun: (id, run) => { state.runs = { ...state.runs, [id]: run }; } };
}
let pings = 0;
const s1 = memStore({ timeZone: TZ, items, runs: {} });
const now = at('2026-11-05T06:00:20Z');
const r1 = await runWakeUpTick({ store: s1, nowMs: now, canPing: async () => null, ping: async () => { pings++; return { model: 'm' }; } });
assert.equal(pings, 1);
assert.deepEqual(r1.map((r) => r.id).sort(), ['d', 't']);
assert.equal(s1.state.runs.d.ok, true);
assert.equal(s1.state.runs.d.key, '2026-11-05T08:00');
assert.deepEqual(await runWakeUpTick({ store: s1, nowMs: now + 20_000, canPing: async () => null, ping: async () => { pings++; } }), []);
assert.equal(pings, 1);

// skipped and failed pings are recorded, never thrown
const s2 = memStore({ timeZone: TZ, items, runs: {} });
await runWakeUpTick({ store: s2, nowMs: now, canPing: async () => 'skipped: not signed in to Claude', ping: async () => { throw new Error('unreachable'); } });
assert.equal(s2.state.runs.d.skipped, true);
assert.match(s2.state.runs.d.detail, /not signed in/);
const s3 = memStore({ timeZone: TZ, items, runs: {} });
await runWakeUpTick({ store: s3, nowMs: now, canPing: async () => null, ping: async () => { throw new Error('429 rate limited'); } });
assert.equal(s3.state.runs.d.ok, false);
assert.match(s3.state.runs.d.detail, /429/);
// broken store / bad zone never throw
assert.deepEqual(await runWakeUpTick({ store: { read: () => { throw new Error('eio'); } }, canPing: async () => null, ping: async () => {} }), []);
const s4 = memStore({ timeZone: 'Not/AZone', items, runs: {} });
assert.ok(Array.isArray(await runWakeUpTick({ store: s4, nowMs: now, canPing: async () => null, ping: async () => ({}) })));

console.log('wake-up: validation, zoned due times, once-per-occurrence, arming, skip/error recording');

import assert from "node:assert/strict";
import { blockReason, exhaustedWindow, installExtraUsageGuard, requestProvider } from "./extra-usage.mjs";

const full = { mode: "plan", fiveHour: { percent: 100, resetsAt: "2026-01-01T00:00:00Z" }, sevenDay: { percent: 40, resetsAt: "x" } };
const fine = { mode: "plan", fiveHour: { percent: 99, resetsAt: "x" }, sevenDay: { percent: 40, resetsAt: "x" } };

assert.equal(exhaustedWindow(full), "5-hour window");
assert.equal(exhaustedWindow(fine), null);
assert.equal(exhaustedWindow({ mode: "signed-out" }), null);
assert.equal(exhaustedWindow({ mode: "unavailable", lastGood: { sevenDay: { percent: 100 } } }), "weekly window");
assert.equal(exhaustedWindow({ mode: "plan", scopedWeekly: { percent: 100, label: "Opus" } }), "Opus weekly window");

assert.equal(blockReason({ blocked: false, membership: true, provider: "anthropic", plan: full }), null);
assert.equal(blockReason({ blocked: true, membership: false, provider: "anthropic", plan: full }), null);
assert.equal(blockReason({ blocked: true, membership: true, provider: "deepseek", plan: full }), null);
assert.equal(blockReason({ blocked: true, membership: true, provider: "anthropic", plan: fine }), null);
assert.match(blockReason({ blocked: true, membership: true, provider: "anthropic", plan: full }), /5-hour window is at 100%/);

assert.equal(requestProvider({ config: { provider: "anthropic" } }), "anthropic");
assert.equal(requestProvider({ header: { config: { provider: "deepseek" } } }), "deepseek");
assert.equal(requestProvider({}), null);

async function collect(it) {
  const out = [];
  for await (const c of it) out.push(c);
  return out;
}
let calls = 0;
const llm = {
  async *stream() {
    calls++;
    yield "a";
    yield "b";
  },
};
let blocked = true;
let plan = full;
installExtraUsageGuard(llm, { isBlocked: () => blocked, isMembership: () => true, readPlan: async () => plan });
await assert.rejects(collect(llm.stream({ config: { provider: "anthropic" } })), /extra usage is disabled/);
assert.equal(calls, 0);
assert.deepEqual(await collect(llm.stream({ config: { provider: "deepseek" } })), ["a", "b"]);
plan = fine;
assert.deepEqual(await collect(llm.stream({ config: { provider: "anthropic" } })), ["a", "b"]);
blocked = false;
plan = full;
assert.deepEqual(await collect(llm.stream({ config: { provider: "anthropic" } })), ["a", "b"]);
plan = null;
blocked = true;
assert.deepEqual(await collect(llm.stream({ config: { provider: "anthropic" } })), ["a", "b"]); // unknown usage fails open
assert.equal(calls, 4);
console.log("extra-usage ok");

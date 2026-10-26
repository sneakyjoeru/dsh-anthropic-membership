// Regression (2026-10-26): DSH 0.2 writes session.v4.jsonl.zstd, the NAS container has no `zstd`
// binary, and DSH_HOME is not ~/.dsh — the card always showed "0 msgs". Build a real v4 log and
// count it through the default decoder and root resolution.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

const home = mkdtempSync(join(tmpdir(), "dsh-msgs-"));
const dir = join(home, "sessions", "--ws--", "session-abc");
mkdirSync(dir, { recursive: true });
const now = Date.now();
const ev = [
  { type: "user/message", time: now - 5000, data: { source: { kind: "user" } } },
  { type: "request/header", time: now - 4900, data: { header: { config: { provider: "anthropic" } } } },
  { type: "user/message", time: now - 3000, data: { source: { kind: "model-selection" } } },
  { type: "user/message", time: now - 2000, data: { source: { kind: "user" } } },
];
const text = ev.map((e) => JSON.stringify(e)).join("\n") + "\n";
// two concatenated frames, like an appended log
writeFileSync(join(dir, "session.v4.jsonl.zstd"),
  Buffer.concat([zstdCompressSync(Buffer.from(text.slice(0, 60))), zstdCompressSync(Buffer.from(text.slice(60)))]));

process.env.DSH_HOME = home;
const { countDshWindow } = await import("./dsh-messages.mjs");
const c = countDshWindow({ sinceMs: now - 60_000, untilMs: now + 1000 });
rmSync(home, { recursive: true, force: true });
assert.equal(c.messages, 2, "v4 log under $DSH_HOME/sessions decoded without the zstd CLI");
assert.equal(c.modelCalls, 1);
console.log("pass");

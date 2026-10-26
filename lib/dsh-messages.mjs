/** Count DSH user messages and Anthropic model calls in a time window. */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as zlib from "node:zlib";

// Session logs are `session.v<format>.jsonl.zstd`; DSH 0.1 wrote v3, DSH 0.2 writes v4.
const SESSION_LOG = /^session\.v\d+\.jsonl\.zstd$/;

/** DSH's session store: $DSH_HOME/sessions when DSH_HOME is set (containers, custom homes). */
export function defaultSessionsRoot(env = process.env) {
  return env.DSH_HOME ? join(env.DSH_HOME, "sessions") : join(homedir(), ".dsh", "sessions");
}

export function countEventsInWindow(events, { sinceMs, untilMs = Infinity } = {}) {
  let messages = 0;
  let modelCalls = 0;
  for (const ev of events) {
    const t = ev?.time;
    if (typeof t !== "number" || t < sinceMs || t > untilMs) continue;
    if (ev.type === "user/message" && ev.data?.source?.kind === "user") messages += 1;
    if (ev.type === "request/header" && ev.data?.header?.config?.provider === "anthropic") {
      modelCalls += 1;
    }
  }
  return { messages, modelCalls };
}

function walkZstdLogs(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (SESSION_LOG.test(ent.name)) out.push(p);
    }
  }
  return out;
}

function decodeZstd(path) {
  // Node >= 22.15 / 23.8 decodes zstd natively (multi-frame, appended logs included); the zstd CLI
  // is only a fallback — DSH's own container image does not ship it.
  if (typeof zlib.zstdDecompressSync === "function") {
    try {
      return zlib.zstdDecompressSync(readFileSync(path)).toString("utf8");
    } catch {
      /* fall through to the CLI */
    }
  }
  const r = spawnSync("zstd", ["-dc", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return r.stdout || "";
}

export function countDshWindow({
  sessionsRoot = defaultSessionsRoot(),
  sinceMs,
  untilMs = Date.now(),
  decode = decodeZstd,
} = {}) {
  if (!Number.isFinite(sinceMs)) return { messages: 0, modelCalls: 0 };
  let messages = 0;
  let modelCalls = 0;
  for (const file of walkZstdLogs(sessionsRoot)) {
    try {
      if (statSync(file).mtimeMs < sinceMs) continue;
    } catch {
      continue;
    }
    const text = decode(file);
    const events = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
    const c = countEventsInWindow(events, { sinceMs, untilMs });
    messages += c.messages;
    modelCalls += c.modelCalls;
  }
  return { messages, modelCalls };
}

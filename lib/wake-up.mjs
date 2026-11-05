/**
 * Wake-up calls: at the times the user picks (daily or on one weekday), send one minimal
 * Claude message so the 5-hour plan window starts at that moment instead of at the first
 * real request. Pure schedule logic lives here; index.js owns storage, the timer and the ping.
 */

export const WAKE_UP_DAYS = Object.freeze(["daily", "workday", "weekend", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const GROUP_DAYS = { workday: ["mon", "tue", "wed", "thu", "fri"], weekend: ["sat", "sun"] };

/** Does the row's day selector include weekday `day` ("mon".."sun")? */
export function dayMatches(selector, day) {
  if (selector === "daily") return true;
  if (GROUP_DAYS[selector]) return GROUP_DAYS[selector].includes(day);
  return selector === day;
}
export const WAKE_UP_MAX_ITEMS = 50;
// A tick missed by a short stall (restart, busy event loop) still fires within this window.
export const WAKE_UP_GRACE_MIN = 10;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SHORT_DAY = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validate a client-supplied list. Throws with a user-facing message on bad input. */
export function normalizeWakeUps(items, { now = Date.now(), previous = [] } = {}) {
  if (!Array.isArray(items)) throw new Error("expected items: [{ id, time, day }]");
  if (items.length > WAKE_UP_MAX_ITEMS) throw new Error(`at most ${WAKE_UP_MAX_ITEMS} wake-up calls`);
  const before = new Map(previous.map((p) => [p.id, p]));
  const seen = new Set();
  return items.map((raw, i) => {
    const id = typeof raw?.id === "string" ? raw.id.trim().slice(0, 64) : "";
    if (!id || seen.has(id)) throw new Error(`row ${i + 1}: missing or duplicate id`);
    seen.add(id);
    if (typeof raw.time !== "string" || !TIME_RE.test(raw.time)) throw new Error(`row ${i + 1}: time must be HH:MM (00:00-23:59)`);
    if (!WAKE_UP_DAYS.includes(raw.day)) throw new Error(`row ${i + 1}: day must be one of ${WAKE_UP_DAYS.join(", ")}`);
    const old = before.get(id);
    // updatedAt arms the row: an occurrence scheduled before the row was created/changed never
    // fires, so setting 08:00 at 08:03 waits for the next 08:00 instead of firing at once.
    const updatedAt = old && old.time === raw.time && old.day === raw.day && typeof old.updatedAt === "number" ? old.updatedAt : now;
    return { id, time: raw.time, day: raw.day, updatedAt };
  });
}

/** Wall-clock parts of `ms` in `timeZone`. */
export function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    day: SHORT_DAY[p.weekday],
    minutes: hour * 60 + Number(p.minute),
    seconds: Number(p.second),
  };
}

function minutesOf(time) {
  const m = TIME_RE.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/**
 * Rows that are due at `nowMs`: today's occurrence (in `timeZone`) has passed by less than the
 * grace window, was scheduled after the row was armed, and has not run yet (`runs[id].key`).
 * Returns [{ item, key }]; `key` identifies the occurrence so it runs once.
 */
export function dueWakeUps(items, { nowMs, timeZone, runs = {}, graceMin = WAKE_UP_GRACE_MIN }) {
  const z = zonedParts(nowMs, timeZone);
  const due = [];
  for (const item of items || []) {
    if (!dayMatches(item.day, z.day)) continue;
    const t = minutesOf(item.time);
    if (t < 0) continue;
    const late = z.minutes - t;
    if (late < 0 || late >= graceMin) continue;
    const scheduledMs = nowMs - (late * 60 + z.seconds) * 1000;
    if (typeof item.updatedAt === "number" && scheduledMs < item.updatedAt - 999) continue;
    const key = `${z.ymd}T${item.time}`;
    if (runs[item.id]?.key === key) continue;
    due.push({ item, key });
  }
  return due;
}

/**
 * One scheduler tick. `store` = { read() -> { timeZone, items, runs }, recordRun(id, run) };
 * `ping()` sends the message (resolves to a detail object or throws); `canPing()` returns null when
 * a ping may be sent, else the reason it is skipped. Never throws: a timer callback must not be able
 * to take the dsh process down.
 */
export async function runWakeUpTick({ store, ping, canPing, nowMs = Date.now(), log = () => {} }) {
  let state;
  try {
    state = store.read();
  } catch (err) {
    log(`wake-up: cannot read schedule: ${err?.message || err}`);
    return [];
  }
  const tz = validTimeZone(state.timeZone) ? state.timeZone : "UTC";
  const due = dueWakeUps(state.items, { nowMs, timeZone: tz, runs: state.runs });
  if (!due.length) return [];
  // Several rows at the same minute need one message, not one each.
  let result;
  try {
    const skip = await canPing();
    if (skip) {
      result = { ok: false, skipped: true, detail: skip };
    } else {
      const detail = await ping();
      result = { ok: true, detail: detail?.model ? `sent to ${detail.model}` : "sent" };
    }
  } catch (err) {
    result = { ok: false, detail: String(err?.message || err).slice(0, 300) };
  }
  for (const { item, key } of due) {
    try {
      store.recordRun(item.id, { key, at: nowMs, ...result });
    } catch (err) {
      log(`wake-up: cannot record run: ${err?.message || err}`);
    }
  }
  log(`wake-up: ${due.map((d) => d.item.time + "/" + d.item.day).join(", ")} -> ${result.ok ? "ok" : result.detail}`);
  return due.map((d) => ({ id: d.item.id, key: d.key, ...result }));
}

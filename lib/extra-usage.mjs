/**
 * Extra-usage guard: when the user disables extra usage in the membership card,
 * refuse Claude membership requests once a plan window (5-hour, weekly, or a
 * model-scoped weekly limit) is at 100 %, instead of letting Anthropic bill the
 * overage to the account balance. Fails open when usage is unknown.
 */

export function exhaustedWindow(plan) {
  if (!plan || (plan.mode !== "plan" && plan.mode !== "unavailable")) return null;
  const src = plan.mode === "unavailable" ? plan.lastGood || plan : plan;
  if (!src) return null;
  if (typeof src.fiveHour?.percent === "number" && src.fiveHour.percent >= 100) return "5-hour window";
  if (typeof src.sevenDay?.percent === "number" && src.sevenDay.percent >= 100) return "weekly window";
  if (typeof src.scopedWeekly?.percent === "number" && src.scopedWeekly.percent >= 100) {
    return `${src.scopedWeekly.label || "model"} weekly window`;
  }
  return null;
}

/** Provider id of an llm.stream request, across the shapes DSH passes. */
export function requestProvider(options) {
  return options?.config?.provider ?? options?.header?.config?.provider ?? options?.provider ?? null;
}

/**
 * Decide whether a request must be refused. Returns the reason string or null.
 * `blocked`: user toggle; `membership`: signed in with a grant and no API key;
 * `plan`: cached usage card.
 */
export function blockReason({ blocked, membership, provider, plan }) {
  if (!blocked || !membership) return null;
  if (provider !== "anthropic") return null;
  const which = exhaustedWindow(plan);
  if (!which) return null;
  return `Claude ${which} is at 100% and extra usage is disabled in the Anthropic membership card; waiting for the window to reset instead of billing extra usage.`;
}

/** Wrap `llm.stream` so blocked requests fail before reaching Anthropic. */
export function installExtraUsageGuard(llm, { isBlocked, isMembership, readPlan }) {
  if (!llm || typeof llm.stream !== "function") {
    throw new Error("llm.stream is missing");
  }
  if (llm.__dshAnthropicExtraUsageGuard) return llm;
  const orig = llm.stream.bind(llm);
  llm.stream = function stream(options) {
    if (!isBlocked() || requestProvider(options) !== "anthropic" || !isMembership()) return orig(options);
    return (async function* guarded() {
      let plan = null;
      try {
        plan = await readPlan();
      } catch {
        plan = null; // usage unknown: fail open
      }
      const reason = blockReason({ blocked: true, membership: true, provider: "anthropic", plan });
      if (reason) throw new Error(reason);
      yield* orig(options);
    })();
  };
  llm.__dshAnthropicExtraUsageGuard = true;
  return llm;
}

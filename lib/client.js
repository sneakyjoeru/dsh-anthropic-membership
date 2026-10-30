window.__ModuleLoader__.load({
  id: "dsh-anthropic-membership",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require("react");
    const jsx = require("react/jsx-runtime");
    const reactDom = require("react-dom");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const FishLogo = primitives.FishLogo;
    const PORT = 8185;
    // On loopback talk to the control API directly. Served from another machine
    // (DSH behind a reverse proxy) the loopback port is unreachable, so use the
    // same-origin path /__membership and let the proxy forward it (see README).
    const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
    const API = LOOPBACK ? "http://127.0.0.1:" + PORT : "/__membership";
    const HEADER = { "x-dsh-membership": "1" };

    function useStatus() {
      const [st, setSt] = react.useState({ signedIn: false, plan: { mode: "signed-out" }, error: null, busy: false, login: null });
      const refresh = react.useCallback(() => {
        fetch(API + "/status", { headers: HEADER })
          .then((r) => r.json())
          .then((j) =>
            setSt((s) => ({
              ...s,
              signedIn: !!j.signedIn,
              plan: j.plan || { mode: j.signedIn ? "plan" : "signed-out" },
              access: j.access || s.access || { full: false },
              codex: j.codex || { available: false },
              extraUsage: j.extraUsage || s.extraUsage || { blocked: false, exhausted: null },
              login: !j.signedIn && j.login && j.login.pending ? { url: j.login.url, phase: j.login.phase } : null,
              canCancelLogin: j.canCancelLogin === true,
              error: j.login && j.login.error ? j.login.error : null,
            })),
          )
          .catch((e) => setSt((s) => ({ ...s, error: String(e) })));
      }, []);
      react.useEffect(() => {
        refresh();
        const id = setInterval(refresh, 4000);
        return () => clearInterval(id);
      }, [refresh]);
      const signIn = react.useCallback(() => {
        setSt((s) => ({ ...s, busy: true, error: null }));
        fetch(API + "/login", { method: "POST", headers: HEADER })
          .then(async (r) => {
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || r.statusText);
            if (j.pending && !j.signedIn) {
              setSt((s) => ({ ...s, busy: false, login: { url: j.url || null }, error: j.error || null }));
              return;
            }
            setSt((s) => ({ ...s, signedIn: !!j.signedIn, plan: j.plan || { mode: "plan" }, error: j.error || null, busy: false, login: null }));
          })
          .catch((e) => setSt((s) => ({ ...s, busy: false, error: String(e.message || e) })));
      }, []);
      const finishSignIn = react.useCallback((input) => {
        setSt((s) => ({ ...s, busy: true, error: null }));
        fetch(API + "/login/code", {
          method: "POST",
          headers: { ...HEADER, "content-type": "application/json" },
          body: JSON.stringify({ input }),
        })
          .then(async (r) => {
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || r.statusText);
            setSt((s) => ({ ...s, signedIn: !!j.signedIn, plan: j.plan || { mode: "plan" }, error: null, busy: false, login: null }));
          })
          .catch((e) => setSt((s) => ({ ...s, busy: false, error: String(e.message || e) })));
      }, []);
      const signOut = react.useCallback(() => {
        fetch(API + "/logout", { method: "POST", headers: HEADER })
          .then((r) => r.json())
          .then((j) => setSt({ signedIn: false, plan: { mode: "signed-out" }, error: null, busy: false }))
          .catch((e) => setSt((s) => ({ ...s, error: String(e) })));
      }, []);
      const setExtraUsage = react.useCallback((blocked) => {
        fetch(API + "/extra-usage", {
          method: "POST",
          headers: { ...HEADER, "content-type": "application/json" },
          body: JSON.stringify({ blocked: !!blocked }),
        })
          .then(async (r) => {
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || r.statusText);
            setSt((s) => ({ ...s, extraUsage: j }));
          })
          .catch((e) => setSt((s) => ({ ...s, error: String(e.message || e) })));
      }, []);
      const setFull = react.useCallback((full) => {
        fetch(API + "/access", {
          method: "POST",
          headers: { ...HEADER, "content-type": "application/json" },
          body: JSON.stringify({ full: !!full }),
        })
          .then((r) => r.json())
          .then((j) => {
            setSt((s) => ({ ...s, access: { full: !!j.full, defaultPreset: j.defaultPreset } }));
            try {
              const ctx = pluginCtx;
              const id = ctx?.sessions?.list?.getSnapshot?.()?.current;
              const live = id ? ctx.sessions.binding(id)?.session : null;
              if (live?.command) {
                live.command(full ? "/permission danger-full-access" : "/permission workspace-write").catch(() => false);
              }
            } catch {
              /* composer PermissionSelect remains the fallback */
            }
          })
          .catch((e) => setSt((s) => ({ ...s, error: String(e.message || e) })));
      }, []);
      // Panel has always passed `cancel: cancelSignIn`; the function did not exist, so the card threw
      // ReferenceError the instant a login was pending (2026-10-30: "clicked sign in and card went away").
      // The host endpoint only aborts a login in flight; a host without that route (older build) would
      // otherwise fail the request, so the local pending state is cleared regardless.
      const canCancelRef = react.useRef(false);
      canCancelRef.current = st.canCancelLogin === true;
      const cancelSignIn = react.useCallback(() => {
        // Clearing the local pending state is always safe; asking the host to abort the login is only
        // safe on a build that advertises canCancelLogin (before 2026-10-30 that request killed dsh).
        setSt((s) => ({ ...s, busy: false, login: null, error: null }));
        if (canCancelRef.current) {
          fetch(API + "/login/cancel", { method: "POST", headers: HEADER }).catch(() => {});
        }
      }, []);
      return { st, signIn, signOut, refresh, setFull, finishSignIn, setExtraUsage, cancelSignIn };
    }

    // Sign-in from a browser that cannot be reached by the loopback callback: open
    // the Claude authorize page in a new tab, then paste the final redirect URL
    // (localhost:53692/callback?code=...) or the code shown.
    function PendingLogin(props) {
      const [code, setCode] = react.useState("");
      return jsx.jsxs("div", {
        style: { fontSize: 13, marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 },
        children: [
          jsx.jsxs("div", {
            children: [
              "1. ",
              props.login.url
                ? jsx.jsx("a", { href: props.login.url, target: "_blank", rel: "noreferrer", children: "Open the Claude sign-in page (new tab)" })
                : props.login.phase === "waiting-code"
                  ? "Link ready — approve in the browser that opened, then paste the redirect below."
                  : "Preparing the Claude sign-in link…",
            ],
          }),
          jsx.jsx("div", {
            children:
              "2. Approve, then copy the final redirect URL from the browser bar (localhost:53692/callback?code=…) or the code shown, and paste it here:",
          }),
          jsx.jsxs("div", {
            style: { display: "flex", gap: 8 },
            children: [
              jsx.jsx("input", {
                type: "text",
                value: code,
                placeholder: "http://localhost:53692/callback?code=…&state=…",
                style: { flex: 1, minWidth: 0 },
                onChange: (e) => setCode(e.target.value),
              }),
              jsx.jsx("button", {
                type: "button",
                disabled: props.busy || !code.trim(),
                onClick: () => props.finish(code),
                children: props.busy ? "Finishing…" : "Finish sign-in",
              }),
              jsx.jsx("button", {
                type: "button",
                onClick: props.cancel,
                children: "Cancel",
              }),
            ],
          }),
        ],
      });
    }

    function fmtReset(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      const same = d.toDateString() === new Date().toDateString();
      const opts = { hour: "numeric", minute: "2-digit" };
      return same ? d.toLocaleTimeString(undefined, opts) : d.toLocaleString(undefined, { ...opts, weekday: "short" });
    }

    function pctColor(p) {
      if (typeof p !== "number") return undefined;
      if (p >= 95) return "#b42318";
      if (p >= 80) return "#b54708";
      return undefined;
    }

    function windowLine(label, win) {
      if (!win || typeof win.percent !== "number") return null;
      return jsx.jsx("div", {
        style: { fontSize: 13, marginBottom: 4, color: pctColor(win.percent) },
        children: label + ": " + win.percent + "% used · resets " + fmtReset(win.resetsAt),
      });
    }

    // One line: [x] Extra usage enabled/disabled: <what happens past the window>.
    // Enabled leaves Anthropic's account setting in charge; disabled makes the plugin
    // refuse Claude requests while a plan window is at 100 %.
    function ExtraUsageLine(plan, extraUsage, onExtraUsage) {
      const eu = extraUsage || { blocked: false, exhausted: null };
      const on = !eu.blocked;
      let text;
      if (!on) {
        text = eu.exhausted
          ? "Extra usage disabled: blocking Claude requests, " + eu.exhausted + " is at 100%."
          : "Extra usage disabled: DSH stops sending to Claude when a plan window reaches 100%.";
      } else if (plan.extraEnabled) {
        text = "Extra usage enabled: messages beyond the plan window are billed to your Anthropic balance.";
      } else {
        text = "Extra usage enabled here, but off in your Anthropic account: messages beyond the plan window are rejected by Anthropic.";
      }
      return jsx.jsxs("label", {
        style: { display: "flex", alignItems: "flex-start", gap: 8, marginTop: 6, cursor: "pointer", color: !on && eu.exhausted ? "#b42318" : undefined },
        title: "Enabled: Anthropic's account setting decides. Disabled: DSH stops sending to Claude at 100% of a plan window instead of billing extra usage.",
        children: [
          jsx.jsx("input", {
            type: "checkbox",
            checked: on,
            style: { marginTop: 2 },
            onChange: (e) => onExtraUsage(!e.target.checked),
          }),
          jsx.jsx("span", { children: text }),
        ],
      });
    }

    function PlanBody(plan, extraUsage, onExtraUsage) {
      if (!plan || plan.mode === "signed-out") {
        return jsx.jsx("div", {
          style: { fontSize: 13, opacity: 0.8, marginBottom: 10 },
          children: "Uses your Claude Pro/Max membership.",
        });
      }
      if (plan.mode === "api") {
        return jsx.jsxs("div", {
          style: { fontSize: 13, marginBottom: 10 },
          children: [
            jsx.jsx("div", { children: "Using Anthropic API key (billed per token)" }),
            jsx.jsx("div", { style: { opacity: 0.8, marginTop: 4 }, children: "Switch to membership" }),
          ],
        });
      }
      const grey = plan.mode === "unavailable" ? { opacity: 0.65 } : {};
      const when = plan.fetchedAt
        ? new Date(plan.fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : null;
      return jsx.jsxs("div", {
        style: { fontSize: 13, marginBottom: 10, ...grey },
        children: [
          plan.mode === "unavailable"
            ? jsx.jsx("div", {
                style: { color: "#b42318", marginBottom: 6 },
                children: "Plan usage unavailable (" + (plan.httpStatus ?? "?") + ")" + (when ? " · " + when : ""),
              })
            : jsx.jsx("div", { style: { marginBottom: 6 }, children: "Signed in · Claude Pro/Max" }),
          windowLine("5-hour window", plan.fiveHour),
          windowLine("Weekly", plan.sevenDay),
          typeof plan.messages === "number" && typeof plan.modelCalls === "number"
            ? jsx.jsx("div", {
                style: { marginTop: 6 },
                children:
                  "Sent from DSH this window: " + plan.messages + " messages · " + plan.modelCalls + " model calls",
              })
            : null,
          jsx.jsx("div", {
            style: { opacity: 0.75, marginTop: 8, fontSize: 12 },
            children:
              "Usage % counts every Claude app on this account. Message counts are DSH only. Anthropic does not publish remaining messages.",
          }),
          ExtraUsageLine(plan, extraUsage, onExtraUsage),
        ],
      });
    }

    function Panel() {
      const { st, signIn, signOut, finishSignIn, setExtraUsage, cancelSignIn } = useStatus();
      return jsx.jsxs("div", {
        style: {
          margin: "12px 0 16px",
          padding: "12px 14px",
          border: "1px solid rgba(127,127,127,0.35)",
          borderRadius: 8,
        },
        children: [
          jsx.jsx("div", {
            style: { fontWeight: 600, marginBottom: 8 },
            children: "Anthropic subscription (Claude Pro/Max)",
          }),
          PlanBody(st.plan, st.extraUsage, setExtraUsage),
          st.error
            ? jsx.jsx("div", { style: { color: "#b42318", fontSize: 13, marginBottom: 8 }, children: st.error })
            : null,
          !st.signedIn && st.login ? jsx.jsx(PendingLogin, { login: st.login, busy: st.busy, finish: finishSignIn, cancel: cancelSignIn }) : null,
          jsx.jsxs("div", {
            style: { display: "flex", gap: 8 },
            children: [
              jsx.jsx("button", {
                type: "button",
                disabled: st.busy || st.signedIn || !!st.login,
                onClick: signIn,
                children: st.busy ? "Waiting for Claude login…" : "Sign in with Claude Pro/Max",
              }),
              st.signedIn
                ? jsx.jsx("button", { type: "button", onClick: signOut, children: "Sign out" })
                : null,
            ],
          }),
        ],
      });
    }

    function Card(props) {
      if (props?.provider?.provider !== "anthropic") return null;
      return jsx.jsx(Panel, {});
    }

    let pluginCtx = null;

    const PLAN_CSS = [
      ".dshAmPlan-wrap{display:flex;justify-content:center;align-items:center;flex-wrap:nowrap;gap:8px;flex:0 1 auto;min-width:0;height:auto;align-self:stretch;box-sizing:border-box;padding:6px 0 2px}",
      // Phones: the plan chip gets its own row under the other dock chips (TPS / speed / context) instead of
      // all of them fighting for one ~360px line. [data-composer-dock] is the dock's stable attribute (its class
      // is hashed per build); the :has() rule flattens any slot wrapper so the chip is a direct flex item.
      "@media (max-width:640px){[data-composer-dock]{flex-wrap:wrap;row-gap:2px}[data-composer-dock]>:not(.dshAmPlan-wrap):has(.dshAmPlan-wrap){display:contents}.dshAmPlan-wrap{flex:1 0 100%;order:1;justify-content:center;padding:2px 0 4px}}",
      ".dshAmPlan-logo{display:inline-flex;align-items:center;color:var(--dsw-alias-label-primary);flex:none;line-height:0}",
      ".dshAmPlan{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;height:28px;padding:2px 5px 2px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-tip,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums;line-height:16px;white-space:nowrap;overflow:hidden}",
      ".dshAmPlan-mark{flex:none;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
      ".dshAmPlan-cell{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}",
      ".dshAmPlan-k{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}",
      ".dshAmPlan-v{font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dshAmPlan-track{display:inline-block;width:34px;height:4px;border-radius:99px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.28));overflow:hidden}",
      ".dshAmPlan-fill{display:block;height:100%;border-radius:inherit;background:currentColor}",
      ".dshAmPlan-cell.is-ok{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary))}",
      ".dshAmPlan-cell.is-warn{color:#b54708;background:color-mix(in srgb,#b54708 14%, transparent)}",
      ".dshAmPlan-cell.is-warn .dshAmPlan-v{color:#b54708}",
      ".dshAmPlan-cell.is-danger{color:var(--dsw-alias-state-error-primary,#b42318);background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#b42318) 16%, transparent)}",
      ".dshAmPlan-cell.is-danger .dshAmPlan-v{color:var(--dsw-alias-state-error-primary,#b42318)}",
      ".dshAmPlan.is-dim{opacity:.82}",
      ".dshAmPlan-wrap,.dshAmPlan-wrap *{pointer-events:auto}",
      ".dshAmPlan-hover{cursor:default}",
      ".dshAmPlan-pop{position:fixed;z-index:2147483000;max-width:380px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.45));border-radius:8px;background:var(--dsw-alias-bg-elevated,var(--dsw-specific-tip,#1f1f1f));color:var(--dsw-alias-label-primary,#eee);font-size:12px;line-height:16px;white-space:normal;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none}",
      ".dshAmPlan-pop div+div{margin-top:3px}",
      ".dshAmPlan-pop .is-cap{opacity:.7;margin-top:6px}",
      ".dshAmPlan-sw{display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 10px 0 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-tip,transparent);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;font-weight:600;line-height:16px}",
      ".dshAmPlan-sw:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dshAmPlan-knob{position:relative;width:28px;height:16px;border-radius:99px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.35));flex:none}",
      ".dshAmPlan-knob:after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:left .12s}",
      ".dshAmPlan-sw.is-on{color:var(--dsw-alias-label-primary)}",
      ".dshAmPlan-sw.is-on .dshAmPlan-knob{background:var(--dsw-alias-state-business-primary,#10a37f)}",
      ".dshAmPlan-sw.is-on .dshAmPlan-knob:after{left:14px}",
    ].join("");

    if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css='dsh-anthropic-membership-plan']")) {
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-anthropic-membership-plan";
      tag.textContent = PLAN_CSS;
      document.head.appendChild(tag);
    }

    function tone(p) {
      if (typeof p !== "number") return "ok";
      if (p >= 95) return "danger";
      if (p >= 80) return "warn";
      return "ok";
    }

    function PlanCell(props) {
      const cls = "dshAmPlan-cell is-" + (props.tone || "ok");
      return jsx.jsxs("span", {
        className: cls,
        children: [
          jsx.jsx("span", { className: "dshAmPlan-k", children: props.k }),
          props.bar != null
            ? jsx.jsx("span", {
                className: "dshAmPlan-track",
                children: jsx.jsx("span", {
                  className: "dshAmPlan-fill",
                  style: { width: Math.max(3, Math.min(100, props.bar)) + "%" },
                }),
              })
            : null,
          jsx.jsx("span", { className: "dshAmPlan-v", children: props.v }),
        ],
      });
    }

    // Time left until a window resets, as "2d 3h 15m" / "4h 12m" / "9m".
    function fmtIn(iso) {
      const ms = Date.parse(iso) - Date.now();
      if (!Number.isFinite(ms)) return "";
      if (ms <= 0) return "now";
      const m = Math.round(ms / 60000);
      const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
      const parts = [];
      if (d) parts.push(d + "d");
      if (d || h) parts.push(h + "h");
      parts.push(mm + "m");
      return "in " + parts.join(" ");
    }

    // Popover text for the dock chip: the plan windows (with time left) and DSH counts.
    function planTooltip(plan) {
      const lines = [];
      if (plan.mode === "unavailable") {
        const when = plan.fetchedAt
          ? new Date(plan.fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
          : null;
        lines.push("Plan usage unavailable (" + (plan.httpStatus ?? "?") + ")" + (when ? " · " + when : ""));
      } else {
        lines.push("Signed in · Claude Pro/Max");
      }
      if (plan.fiveHour && typeof plan.fiveHour.percent === "number") {
        lines.push("5-hour window: " + plan.fiveHour.percent + "% used · resets " + fmtIn(plan.fiveHour.resetsAt));
      }
      if (plan.sevenDay && typeof plan.sevenDay.percent === "number") {
        lines.push("Weekly: " + plan.sevenDay.percent + "% used · resets " + fmtIn(plan.sevenDay.resetsAt));
      }
      if (plan.scopedWeekly && typeof plan.scopedWeekly.percent === "number" && plan.scopedWeekly.label) {
        lines.push(plan.scopedWeekly.label + ": " + plan.scopedWeekly.percent + "% used · resets " + fmtIn(plan.scopedWeekly.resetsAt));
      }
      if (typeof plan.messages === "number" && typeof plan.modelCalls === "number") {
        lines.push("Sent from DSH this window: " + plan.messages + " messages · " + plan.modelCalls + " model calls");
      }
      return lines.join("\n");
    }

    // The dock never shows native title tooltips, so the chip draws its own popover
    // (portal to <body>, fixed above the chip): hover shows it, click pins it.
    function PlanPopover(props) {
      const el = props.anchor;
      if (!el || typeof document === "undefined") return null;
      const r = el.getBoundingClientRect();
      const lines = planTooltip(props.plan).split("\n");
      const style = { left: Math.max(8, Math.min(r.left, window.innerWidth - 400)), bottom: Math.max(8, window.innerHeight - r.top + 8) };
      return reactDom.createPortal(
        jsx.jsx("div", {
          className: "dshAmPlan-pop",
          style,
          children: lines.map((l, i) => jsx.jsx("div", { className: l.startsWith("Usage %") ? "is-cap" : "", children: l }, i)),
        }),
        document.body,
      );
    }
    function ClaudeChip(props) {
      const plan = props.plan;
      const [hover, setHover] = react.useState(false);
      const [pinned, setPinned] = react.useState(false);
      const ref = react.useRef(null);
      react.useEffect(() => {
        if (!pinned || typeof document === "undefined") return undefined;
        const off = (e) => {
          if (ref.current && ref.current.contains(e.target)) return;
          setPinned(false);
        };
        document.addEventListener("mousedown", off, true);
        return () => document.removeEventListener("mousedown", off, true);
      }, [pinned]);
      const body = ClaudeChipBody(plan);
      const open = (hover || pinned) && plan && plan.mode !== "signed-out" && plan.mode !== "api";
      return jsx.jsxs("span", {
        ref,
        className: "dshAmPlan-hover",
        style: { display: "inline-flex" },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => setPinned((v) => !v),
        children: [body, open ? jsx.jsx(PlanPopover, { plan, anchor: ref.current }) : null],
      });
    }
    function ClaudeChipBody(plan) {
      if (!plan || plan.mode === "signed-out") {
        return jsx.jsxs("div", {
          className: "dshAmPlan is-dim",
          title: "Sign in with Claude Pro/Max in Settings → Models",
          children: [
            jsx.jsx("span", { className: "dshAmPlan-mark", children: "Claude" }),
            jsx.jsx(PlanCell, { k: "plan", v: "off" }),
          ],
        });
      }
      if (plan.mode === "api") {
        return jsx.jsxs("div", {
          className: "dshAmPlan",
          title: "Using Anthropic API key (billed per token)",
          children: [
            jsx.jsx("span", { className: "dshAmPlan-mark", children: "Claude" }),
            jsx.jsx(PlanCell, { k: "api", v: "key" }),
          ],
        });
      }
      const five = plan.fiveHour && typeof plan.fiveHour.percent === "number" ? plan.fiveHour.percent : null;
      const week = plan.sevenDay && typeof plan.sevenDay.percent === "number" ? plan.sevenDay.percent : null;
      return jsx.jsxs("div", {
        className: "dshAmPlan" + (plan.mode === "unavailable" ? " is-dim" : ""),
        children: [
          jsx.jsx("span", { className: "dshAmPlan-mark", children: "Claude" }),
          jsx.jsx(PlanCell, { k: "5h", v: five !== null ? five + "%" : "—", bar: five, tone: tone(five) }),
          jsx.jsx(PlanCell, { k: "wk", v: week !== null ? week + "%" : "—", bar: week, tone: tone(week) }),
        ],
      });
    }

    function CodexChip(codex) {
      const on = !!(codex && codex.available);
      if (!on) return null; // signed-out "plan off" chip only eats dock width; hide until a grant exists
      const five = codex.fiveHour && typeof codex.fiveHour.percent === "number" ? codex.fiveHour.percent : null;
      return jsx.jsxs("div", {
        className: "dshAmPlan" + (on ? "" : " is-dim"),
        title: on
          ? "ChatGPT Codex usage"
          : "Codex consumption lights up once an openai-codex grant is signed in.",
        children: [
          jsx.jsx("span", { className: "dshAmPlan-mark", children: "Codex" }),
          five !== null
            ? jsx.jsx(PlanCell, { k: "5h", v: five + "%", bar: five, tone: tone(five) })
            : jsx.jsx(PlanCell, { k: "plan", v: on ? "on" : "off" }),
        ],
      });
    }

    function DockWidget() {
      const { st } = useStatus();
      return jsx.jsxs("div", {
        className: "dshAmPlan-wrap",
        children: [
          jsx.jsx("span", {
            className: "dshAmPlan-logo",
            title: "DeepSeek Harness",
            children: jsx.jsx(FishLogo, { size: 18 }),
          }),
          jsx.jsx(ClaudeChip, { plan: st.plan }),
          CodexChip(st.codex),
        ],
      });
    }

    function apply(ctx) {
      pluginCtx = ctx;
      ctx.slots.inject("settings.models.provider-card", () =>
        ctx.slots.register(
          {
            name: "settings.models.provider-card",
            key: "llm-pi-ai",
          },
          Card,
        ),
      );
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "anthropic-plan",
            order: -20,
            label: "Consumption",
          },
          DockWidget,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "sessions"];
    return module.exports;
  },
});

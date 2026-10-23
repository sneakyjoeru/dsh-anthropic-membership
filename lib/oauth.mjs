/** Shared Claude Pro/Max OAuth + DSH credential/settings writes. */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDshNodeModules } from "./dsh-nm.mjs";

export const PORT = 8185;
// Resolve the harness node_modules the same way the other modules do
// (DSH_NODE_MODULES env -> import.meta -> argv[1] -> known install paths) instead
// of pinning the macOS homebrew path, so Linux / container installs work too.
export const DSH_NM = resolveDshNodeModules();
export const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
export const OLLAMA_SETTINGS = join(homedir(), ".ollama/launch/dsh/settings.yaml");
export const RECORD = "llm-pi-ai/anthropic";
// Extra browser origins may be allowed with DSH_MEMBERSHIP_ORIGINS (comma separated),
// e.g. a DSH served on another port or behind a reverse proxy.
export const ALLOWED_ORIGINS = Object.freeze([
  "http://127.0.0.1:3080",
  "http://localhost:3080",
  ...(process.env.DSH_MEMBERSHIP_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);

const yamlMod = await import(pathToFileURL(join(DSH_NM, "yaml/dist/index.js")).href);
const YAML = yamlMod.default ?? yamlMod;
const { createModels } = await import(
  pathToFileURL(join(DSH_NM, "@earendil-works/pi-ai/dist/index.js")).href
);
const { anthropicProvider } = await import(
  pathToFileURL(join(DSH_NM, "@earendil-works/pi-ai/dist/providers/anthropic.js")).href
);

export function resolveSettingsPath() {
  if (process.env.DSH_SETTINGS) return process.env.DSH_SETTINGS;
  if (existsSync(OLLAMA_SETTINGS)) return OLLAMA_SETTINGS;
  return join(DSH_HOME, "settings.yaml");
}

export const SETTINGS = resolveSettingsPath();
export const CREDS = join(DSH_HOME, ".credentials.yaml");

function loadYaml(path, fallback) {
  if (!existsSync(path)) return fallback;
  const parsed = YAML.parse(readFileSync(path, "utf8"));
  return parsed && typeof parsed === "object" ? parsed : fallback;
}

function atomicWrite(path, text, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, { encoding: "utf8", mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

export function ensureSettings() {
  if (!existsSync(SETTINGS)) {
    atomicWrite(
      SETTINGS,
      YAML.stringify({
        "llm-pi-ai": {
          providers: {
            anthropic: { displayName: "Anthropic (Claude Pro/Max)" },
          },
        },
      }),
      0o600,
    );
    return SETTINGS;
  }
  const doc = YAML.parseDocument(readFileSync(SETTINGS, "utf8"));
  if (!doc.getIn(["llm-pi-ai"])) doc.setIn(["llm-pi-ai"], {});
  if (!doc.getIn(["llm-pi-ai", "providers"])) doc.setIn(["llm-pi-ai", "providers"], {});
  const anth = doc.getIn(["llm-pi-ai", "providers", "anthropic"]);
  if (!anth) {
    doc.setIn(["llm-pi-ai", "providers", "anthropic"], {
      displayName: "Anthropic (Claude Pro/Max)",
    });
  } else if (anth && typeof anth.delete === "function") {
    anth.delete("apiKeyEnv");
    if (!anth.get("displayName")) anth.set("displayName", "Anthropic (Claude Pro/Max)");
  }
  atomicWrite(SETTINGS, String(doc), 0o600);
  return SETTINGS;
}

function loadCredDoc() {
  const doc = loadYaml(CREDS, { version: 1, refs: {}, records: {} });
  if (doc.version == null) doc.version = 1;
  if (!doc.refs || typeof doc.refs !== "object") doc.refs = {};
  if (!doc.records || typeof doc.records !== "object") doc.records = {};
  return doc;
}

function fileStore() {
  return {
    async read(providerId) {
      if (providerId !== "anthropic") return undefined;
      const rec = loadCredDoc().records[RECORD];
      if (rec?.kind === "grant" && rec.payload?.type === "oauth") return rec.payload;
      return undefined;
    },
    async list() {
      const rec = loadCredDoc().records[RECORD];
      if (rec?.kind === "grant" && rec.payload?.type === "oauth") {
        return [{ providerId: "anthropic", type: "oauth" }];
      }
      return [];
    },
    async modify(providerId, fn) {
      if (providerId !== "anthropic") {
        throw new Error(`this store only holds anthropic, not ${providerId}`);
      }
      const doc = loadCredDoc();
      const rec = doc.records[RECORD];
      const current =
        rec?.kind === "grant" && rec.payload?.type === "oauth" ? rec.payload : undefined;
      const next = await fn(current);
      if (next == null) delete doc.records[RECORD];
      else doc.records[RECORD] = { kind: "grant", payload: next };
      atomicWrite(CREDS, YAML.stringify(doc), 0o600);
      return next;
    },
    async delete(providerId) {
      if (providerId !== "anthropic") return;
      const doc = loadCredDoc();
      delete doc.records[RECORD];
      atomicWrite(CREDS, YAML.stringify(doc), 0o600);
    },
  };
}

function openUrl(url) {
  // Without an error listener a missing `open` binary (Linux, containers) raises an
  // unhandled 'error' event that can take the web process down mid-login.
  const child = spawn("open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export function status() {
  const rec = loadCredDoc().records[RECORD];
  const payload = rec?.kind === "grant" ? rec.payload : undefined;
  const signedIn = payload?.type === "oauth" && typeof payload.access === "string";
  return {
    signedIn,
    expiresAt: signedIn && typeof payload.expires === "number" ? payload.expires : null,
  };
}

/** Access token for host-side usage fetch. Never log the return value. */
export function getAccessToken() {
  const rec = loadCredDoc().records[RECORD];
  const payload = rec?.kind === "grant" ? rec.payload : undefined;
  if (payload?.type === "oauth" && typeof payload.access === "string") return payload.access;
  return null;
}

export function apiKeyInEnv() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const PERMISSION_PRESETS = new Set(["danger-full-access", "workspace-write"]);

export function getPermissionDefault() {
  const doc = loadYaml(SETTINGS, {});
  const v = doc?.permission?.defaultPreset;
  return PERMISSION_PRESETS.has(v) ? v : "workspace-write";
}

export function setPermissionDefault(preset) {
  if (!PERMISSION_PRESETS.has(preset)) throw new Error("unknown permission preset");
  ensureSettings();
  const doc = YAML.parseDocument(readFileSync(SETTINGS, "utf8"));
  if (!doc.get("permission")) doc.set("permission", {});
  doc.setIn(["permission", "defaultPreset"], preset);
  atomicWrite(SETTINGS, String(doc), 0o600);
  return preset;
}

// Remote / headless sign-in: when the browser is on another machine (DSH behind a
// reverse proxy) or the host has no browser, pi-ai's loopback callback
// (localhost:53692) never fires. Keep the auth URL and the manual-code resolver
// here; index.js hands the URL to the client and feeds the pasted redirect URL or
// code back through submitLoginCode(). The loopback callback still works as before.
export const loginPending = { url: null, message: null, startedAt: 0, resolveCode: null, rejectCode: null };
export function submitLoginCode(input) {
  const resolve = loginPending.resolveCode;
  if (!resolve) throw new Error("no sign-in in progress");
  loginPending.resolveCode = null;
  loginPending.rejectCode = null;
  resolve(String(input || "").trim());
}
export async function login({ onNotice } = {}) {
  ensureSettings();
  const models = createModels({ credentials: fileStore() });
  models.setProvider(anthropicProvider());
  loginPending.url = null;
  loginPending.message = null;
  loginPending.startedAt = Date.now();
  try {
    const cred = await models.login("anthropic", "oauth", {
      signal: AbortSignal.timeout(10 * 60 * 1000),
      notify(event) {
        if (event?.type === "auth_url" && event.url) {
          loginPending.url = event.url;
          onNotice?.({ message: "Opening Claude Pro/Max in the browser", url: event.url });
          try {
            openUrl(event.url);
          } catch {
            /* ignore */
          }
          return;
        }
        if (event?.message) {
          loginPending.message = event.message;
          onNotice?.({ message: event.message });
        }
      },
      prompt() {
        return new Promise((resolve, reject) => {
          loginPending.resolveCode = resolve;
          loginPending.rejectCode = reject;
        });
      },
    });
    if (!cred || cred.type !== "oauth" || !cred.access) {
      throw new Error("login returned no OAuth grant");
    }
    return status();
  } finally {
    loginPending.url = null;
    loginPending.message = null;
    loginPending.startedAt = 0;
    loginPending.resolveCode = null;
    loginPending.rejectCode = null;
  }
}

export function logout() {
  const doc = loadCredDoc();
  delete doc.records[RECORD];
  atomicWrite(CREDS, YAML.stringify(doc), 0o600);
  return status();
}

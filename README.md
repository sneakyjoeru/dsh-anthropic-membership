# dsh-anthropic-membership

DeepSeek Harness plugin: **Sign in with Claude Pro/Max**. Uses the same Anthropic membership OAuth grant Claude Code uses (`isSubscription: true`). No Anthropic API key.

It also unblocks two Anthropic-specific lockups that otherwise freeze a long session:

1. **Many-image 2000px cap** — DSH can store request images with a long edge of 2048px. Anthropic rejects many-image requests above 2000px, and retries keep sending the same history. This plugin downscales request images to a 2000px long edge.
2. **`/compact` over a 1M window** — when the live prompt is already over the model cap, DSH's summarizer replays that same prompt and fails with `Compaction could not produce a useful summary`. This plugin slims compaction calls (drop images and reasoning, truncate huge tool text) so `/compact` can land.

## Install

Requires the `dsh` CLI.

```sh
dsh plugin --profile web add github:antonio-mastropaolo/dsh-anthropic-membership
```

From a local checkout:

```sh
git clone https://github.com/antonio-mastropaolo/dsh-anthropic-membership.git
dsh plugin --profile web add file:./dsh-anthropic-membership
```

Restart `dsh web`. Open **Settings → Models**. On the Anthropic card: **Sign in with Claude Pro/Max**. Then pick an `anthropic` / `claude-*` model.

A compact chip on the main composer dock shows `Claude · 5h N% · wk N% · N msgs`. The Anthropic card shows **plan-window %** (5-hour and weekly) and **DSH message counts** for that window. It does not show remaining messages, tokens, or dollars. Usage % is account-wide (every Claude app); message counts are DSH only.

If the UI is down:

```sh
node login.mjs
node logout.mjs
node usage.mjs
```

## What it writes

- Settings: `llm-pi-ai.providers.anthropic` (no `apiKeyEnv`) in `~/.dsh/settings.yaml`, or `$DSH_SETTINGS` if set. If you launch DSH from Ollama and `~/.ollama/launch/dsh/settings.yaml` exists, that file is used instead.
- Grant: `llm-pi-ai/anthropic` in `~/.dsh/.credentials.yaml` (mode 0600). Never logged.

## Control API

Loopback only, `127.0.0.1:8185` (override with `DSH_MEMBERSHIP_PORT`; the Settings button expects 8185).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | `{ ok: true }` |
| GET | `/status` | `{ signedIn, expiresAt, imageCap, compactionSlim }` — Origin must be the DSH UI if `Origin` is sent |
| POST | `/login` `/logout` | Requires `Origin: http://127.0.0.1:3080` (or `localhost`) and header `x-dsh-membership: 1` |

CORS does not reflect arbitrary `Origin`. A missing CSRF header is 403. `/login` is 409 if a login is already in flight.



## Extra usage toggle

The membership card has an **Extra usage enabled / disabled** checkbox (stored in `$DSH_HOME/anthropic-membership.yaml`, `POST /extra-usage {"blocked": true|false}`). *Enabled* (default) leaves Anthropic's own account setting in charge. *Disabled* wraps `llm.stream`: once the usage card shows a plan window at 100 % (5-hour, weekly, or a model-scoped weekly limit) Claude membership requests fail with a clear message instead of being billed as extra usage; other providers and API-key mode are untouched, and unknown usage fails open. `/status` reports `extraUsage: {blocked, exhausted}`.

## Remote browsers and headless hosts

The control API is loopback-only and the Claude OAuth callback goes to `http://localhost:53692/callback` on the machine running DSH. When the browser is on another machine (DSH behind a reverse proxy) or the host has no browser:

- **Sign in** returns the Claude authorize link right away and the card shows a paste box. Open the link, approve, then paste the final redirect URL (`localhost:53692/callback?code=…&state=…`, the page itself may fail to load) or the code into the box and click **Finish sign-in** (`POST /login/code {"input": "..."}`). On loopback the callback still completes the login by itself.
- Served from a non-loopback origin the page calls the same-origin path **`/__membership/*`**; make the reverse proxy in front of DSH forward that prefix to `127.0.0.1:8185` (strip the prefix) and send an allowed `Origin`, or list the public origin in `DSH_MEMBERSHIP_ORIGINS` (comma separated).
- In a container publish the port with `DSH_MEMBERSHIP_BIND=0.0.0.0`; requests stay gated by `Origin` and the `x-dsh-membership` header.

## Tests

```sh
npm test
```

Needs a DSH install on disk so `sharp` resolves (or set `DSH_NODE_MODULES` to that `node_modules` directory).

## License

MIT

## macOS app window (Helixboard-style)

`/Applications/DSH v1.app` opens DeepSeek Harness in a chromeless Chrome `--app` window (same pattern as Helixcode Dashboard v1). It starts `dsh web` if needed and uses the current launch token. Drag it to the Dock for one click.

The composer dock shows **Claude** 5h/weekly %, a **Codex** slot (lights up when an openai-codex grant exists), and a **Full access** switch (sets `permission.defaultPreset` and `/permission danger-full-access` on the live session).

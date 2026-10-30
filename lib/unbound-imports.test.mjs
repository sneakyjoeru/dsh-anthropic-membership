// Guards the crash of 2026-10-30: the /login/cancel handler called `cancelLogin()`, which oauth.mjs
// exports but index.js never imported — the ReferenceError became an uncaught exception and took the
// whole dsh process down (the session died mid-turn, docker restarted the container).
// A function call to a missing identifier is invisible to `node --check` and to import smoke tests,
// so check it statically: every name a sibling module exports and index.js CALLS must be imported.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, 'index.js'), 'utf8');
const siblings = ['oauth.mjs', 'extra-usage.mjs', 'plan-usage.mjs', 'full-access.mjs', 'dsh-messages.mjs', 'compact-payload.mjs', 'request-image.mjs'];

const imported = new Set();
for (const m of indexSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/[^"]+"/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop();
    if (name) imported.add(name);
  }
}

// names index.js declares itself (function/const/let/class) never need importing
const declared = new Set();
for (const m of indexSrc.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/gm)) {
  const name = m[1] || m[2];
  if (name) declared.add(name);
}

const missing = [];
for (const file of siblings) {
  const src = readFileSync(join(here, file), 'utf8');
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) {
    const name = m[1];
    // only names this file actually uses
    const used = new RegExp(`(?<![.\\w$])${name}\\s*\\(`);
    if (used.test(indexSrc) && !imported.has(name) && !declared.has(name)) missing.push(`${name} (from ${file})`);
  }
}

assert.deepEqual(missing, [], `index.js calls identifiers it never imports: ${missing.join(', ')}`);
console.log('unbound-imports: every sibling export used by index.js is imported');

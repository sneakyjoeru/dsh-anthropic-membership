// Regression: Anthropic's OAuth flow asks for the login method before it builds the
// authorize URL. An unanswered select prompt left the card on "Preparing the Claude
// sign-in link…" forever (2026-10-26).
import assert from "node:assert/strict";
import { chooseLoginMethod, loginPending, submitLoginCode, cancelLogin } from "./oauth.mjs";

const question = {
  type: "select",
  message: "Select Anthropic login method:",
  options: [
    { id: "browser", label: "Browser login (default)" },
    { id: "copy_code", label: "Copy code login (headless)" },
  ],
};

assert.equal(chooseLoginMethod(question), process.env.DSH_ANTHROPIC_LOGIN_METHOD || "browser");
assert.equal(chooseLoginMethod({ options: [{ id: "copy_code" }] }), "copy_code", "falls back to the only option");
assert.equal(chooseLoginMethod({}), undefined, "no options -> undefined, never a hang");

// Manual-code prompt: resolves with the pasted value, then clears the slot.
const answered = new Promise((resolve) => {
  loginPending.resolveCode = resolve;
  loginPending.rejectCode = () => {};
});
submitLoginCode("  http://localhost:53692/callback?code=abc&state=xyz  ");
assert.equal(await answered, "http://localhost:53692/callback?code=abc&state=xyz");
assert.equal(loginPending.resolveCode, null);
assert.throws(() => submitLoginCode("again"), /no sign-in in progress/, "second paste without an attempt is refused");

// Cancel is always callable; with no active attempt it is a no-op, with one it aborts.
assert.deepEqual(cancelLogin(), { cancelled: true });
loginPending.resolveCode = null;
loginPending.rejectCode = null;
console.log("pass");

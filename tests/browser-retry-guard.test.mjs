import assert from "node:assert/strict";
import { BrowserRetryLimitError, BrowserRetryGuard } from "../dsh-plugin/tools/browser-retry-guard.ts";

const snapshot = {
  text: "URL: https://example.test/post\n[1] button \"Delete\"",
  fingerprint: "menu-open",
  refs: {
    "1": { tag: "button", role: "button", name: "Delete", path: "body[0] > button[0]" },
    "2": { tag: "button", role: "button", name: "Delete", path: "body[0] > div[0] > button[0]", parentRef: 3 },
  },
};

const guard = new BrowserRetryGuard();
guard.updateSnapshot(snapshot);
guard.before({ method: "click", params: { ref: 1 } });
guard.before({ method: "click", params: { ref: 1 } });

assert.throws(
  () => guard.before({ method: "click", params: { ref: 1 } }),
  (error) => error instanceof BrowserRetryLimitError && !error.hardStop && /different observed approach/.test(error.message),
);
assert.throws(
  () => guard.before({ method: "click", params: { ref: 1 } }),
  (error) => error instanceof BrowserRetryLimitError && error.hardStop && /task is paused/.test(error.message),
);

guard.before({ method: "click", params: { ref: 2 } });

const reloadGuard = new BrowserRetryGuard();
reloadGuard.updateSnapshot(snapshot);
reloadGuard.before({ method: "navigate", params: { url: "https://example.test/post" } });
reloadGuard.before({ method: "navigate", params: { url: "https://example.test/post#comments" } });
assert.throws(() => reloadGuard.before({ method: "navigate", params: { url: "https://example.test/post" } }), BrowserRetryLimitError);

console.log("browser retry guard scenarios passed");

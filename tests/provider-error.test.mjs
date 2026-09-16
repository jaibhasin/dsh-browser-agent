import assert from "node:assert/strict";
import test from "node:test";

const { formatBridgeFailure } = await import("../shared/provider-error.ts");

test("turns an OpenRouter key limit response into actionable copy", () => {
  const raw = '403: {"message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/example","code":403}';
  const result = formatBridgeFailure("DSH_CHAT_FAILED", raw);

  assert.equal(result, "OpenRouter rejected this request because the API key reached its spending limit. Increase or remove the key limit in OpenRouter, or replace the OpenRouter API key in DSH Settings > Models, then try again.");
  assert.doesNotMatch(result, /DSH_CHAT_FAILED|\{"message"|\/keys\/example/);
});

test("preserves bridge context for unrelated failures", () => {
  assert.equal(formatBridgeFailure("DSH_CHAT_FAILED", "The model timed out."), "DSH_CHAT_FAILED: The model timed out.");
});

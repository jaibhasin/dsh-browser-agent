import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBridgeMessage, PROTOCOL_VERSION } from "../shared/protocol.ts";

test("accepts the bridge smoke-test chat shape", () => {
  const message = parseBridgeMessage({
    type: "chat",
    id: "test-1",
    text: "Respond with exactly one short greeting sentence.",
    sessionId: "bridge-smoke",
    resume: false,
  });
  assert.equal(message?.type, "chat");
});

test("rejects bridge chat messages without session state", () => {
  assert.equal(parseBridgeMessage({
    type: "chat",
    id: "test-1",
    text: "hello",
  }), undefined);
});

test("accepts only the current protocol version and extension client", () => {
  const base = { type: "hello", protocolVersion: PROTOCOL_VERSION, token: "a".repeat(64), client: "chrome-extension" };
  assert.equal(parseBridgeMessage(base)?.type, "hello");
  assert.equal(parseBridgeMessage({ ...base, protocolVersion: PROTOCOL_VERSION + 1 }), undefined);
  assert.equal(parseBridgeMessage({ ...base, client: "test-client" }), undefined);
});

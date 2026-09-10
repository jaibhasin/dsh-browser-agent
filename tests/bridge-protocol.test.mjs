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

test("accepts a typed task draft request and response", () => {
  const request = parseBridgeMessage({
    type: "task_draft",
    id: "draft-1",
    sourceSessionId: "session-1",
    conversation: "Check the current pull request.",
    answers: { target: "main" },
  });
  assert.equal(request?.type, "task_draft");
  const response = parseBridgeMessage({
    type: "task_draft_response",
    id: "draft-1",
    status: "needs-input",
    draft: {
      name: "Review PR",
      instructions: "Review the current PR.",
      startingContext: { kind: "current-page" },
      parameters: [],
      constraints: "",
      expectedResult: "Findings",
      warnings: [],
    },
    questions: [{ id: "target", question: "Which branch?", options: ["main"], allowFreeText: false }],
  });
  assert.equal(response?.type, "task_draft_response");
});

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
  const base = { type: "hello", protocolVersion: PROTOCOL_VERSION, token: "a".repeat(64), client: "chrome-extension", clientId: "11111111-1111-4111-8111-111111111111" };
  assert.equal(parseBridgeMessage(base)?.type, "hello");
  assert.equal(parseBridgeMessage({ ...base, protocolVersion: PROTOCOL_VERSION + 1 }), undefined);
  assert.equal(parseBridgeMessage({ ...base, client: "test-client" }), undefined);
  assert.equal(parseBridgeMessage({ ...base, clientId: "not-a-uuid" }), undefined);
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

test("accepts shared saved-task load and save messages", () => {
  assert.equal(parseBridgeMessage({ type: "saved_tasks", id: "tasks-1", operation: "load" })?.type, "saved_tasks");
  assert.equal(parseBridgeMessage({ type: "saved_tasks", id: "tasks-2", operation: "save", tasks: [{ id: "task-1" }] })?.type, "saved_tasks");
  assert.equal(parseBridgeMessage({ type: "saved_tasks_response", id: "tasks-2", initialized: true, tasks: [{ id: "task-1" }] })?.type, "saved_tasks_response");
  assert.equal(parseBridgeMessage({ type: "saved_tasks", id: "tasks-3", operation: "save", tasks: [undefined] }), undefined);
});

test("accepts shared saved-chat load and save messages", () => {
  assert.equal(parseBridgeMessage({ type: "saved_chats", id: "chats-1", operation: "load" })?.type, "saved_chats");
  assert.equal(parseBridgeMessage({ type: "saved_chats", id: "chats-2", operation: "save", chats: [{ id: "chat-1" }] })?.type, "saved_chats");
  assert.equal(parseBridgeMessage({ type: "saved_chats_response", id: "chats-2", initialized: true, chats: [{ id: "chat-1" }] })?.type, "saved_chats_response");
});

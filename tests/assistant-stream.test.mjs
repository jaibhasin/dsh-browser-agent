import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantStream } from "../extension/sidepanel/src/assistant-stream.ts";

function makeManualScheduler() {
  const frames = [];
  return {
    frames,
    schedule: (callback) => frames.push(callback) - 1,
    cancel: (handle) => { frames[handle] = undefined; },
  };
}

test("renders a multi-word delta one character at a time", () => {
  const updates = [];
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream((assistant) => updates.push(assistant?.text ?? ""), scheduler.schedule, scheduler.cancel);

  stream.append({ id: "chat-1", sessionId: "session-1", text: "Hello world" });
  assert.deepEqual(updates, [""]);

  scheduler.frames.shift()();
  scheduler.frames.shift()();
  assert.deepEqual(updates, ["", "H", "He"]);
});

test("drains to the final response before completing", async () => {
  const updates = [];
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream((assistant) => updates.push(assistant?.text ?? ""), scheduler.schedule, scheduler.cancel);

  stream.append({ id: "chat-1", sessionId: "session-1", text: "Hello" });
  const finished = stream.finish("chat-1", "Hello world");
  while (scheduler.frames.length > 0) {
    const frame = scheduler.frames.shift();
    if (frame) frame();
  }
  await finished;

  assert.equal(updates.at(-1), "Hello world");
  assert.ok(updates.includes("Hello w"));
});

test("exposes all received text even when animation is behind", () => {
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream(() => {}, scheduler.schedule, scheduler.cancel);

  stream.append({ id: "chat-1", sessionId: "session-1", text: "Hello world" });

  assert.equal(stream.getTarget("chat-1"), "Hello world");
});

test("completes when the final response differs from streamed text", async () => {
  const updates = [];
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream((assistant) => updates.push(assistant?.text ?? ""), scheduler.schedule, scheduler.cancel);

  stream.append({ id: "chat-1", sessionId: "session-1", text: "Hello world" });
  for (let index = 0; index < 20 && scheduler.frames.length > 0; index += 1) {
    const frame = scheduler.frames.shift();
    if (frame) frame();
  }
  assert.equal(updates.at(-1), "Hello world");

  let settled = false;
  const finished = stream.finish("chat-1", "Hello").then(() => { settled = true; });
  for (let index = 0; index < 3 && scheduler.frames.length > 0; index += 1) {
    const frame = scheduler.frames.shift();
    if (frame) frame();
  }
  await Promise.resolve();
  assert.equal(settled, true);
  await finished;

  assert.equal(updates.at(-1), "Hello");
  stream.clear("chat-1");
  assert.equal(updates.at(-1), "");
});

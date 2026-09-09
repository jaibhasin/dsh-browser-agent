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

// Runs queued animation frames until the stream stops rescheduling (caught up)
// or the tick budget runs out; returns how many ticks were consumed.
function drain(scheduler, maxTicks = 100) {
  let ticks = 0;
  while (scheduler.frames.length > 0 && ticks < maxTicks) {
    const frame = scheduler.frames.shift();
    if (frame) frame();
    ticks += 1;
  }
  return ticks;
}

test("reveals word-sized chunks instead of one character at a time", () => {
  const updates = [];
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream((assistant) => updates.push(assistant?.text ?? ""), scheduler.schedule, scheduler.cancel);

  stream.append({ id: "chat-1", sessionId: "session-1", text: "Hello world" });
  assert.deepEqual(updates, [""]);

  drain(scheduler, 1);
  // First beat lands on the word boundary after "Hello" — a multi-character
  // chunk, not the single character "H" the old typewriter produced.
  assert.deepEqual(updates, ["", "Hello"]);

  drain(scheduler);
  assert.equal(updates.at(-1), "Hello world");
  // Every beat must advance by more than one character (chunked, not per-char).
  for (let index = 2; index < updates.length; index += 1) {
    assert.ok(updates[index].length - updates[index - 1].length >= 2, `beat ${index} revealed only one character`);
  }
});

test("drains a large backlog quickly instead of typing it out", () => {
  const updates = [];
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream((assistant) => updates.push(assistant?.text ?? ""), scheduler.schedule, scheduler.cancel);

  const text = "alpha ".repeat(40).trimEnd(); // 240 characters
  stream.append({ id: "chat-1", sessionId: "session-1", text });
  const ticks = drain(scheduler, 60);

  assert.equal(updates.at(-1), text);
  // Character-at-a-time rendering would need 240 beats; adaptive chunking
  // should finish within a handful of them.
  assert.ok(updates.length <= 20, `expected a few chunk reveals, got ${updates.length}`);
  assert.ok(ticks <= 40, `expected fast drain, took ${ticks} ticks`);
});

test("drains to the final response before completing", async () => {
  const updates = [];
  const scheduler = makeManualScheduler();
  const stream = createAssistantStream((assistant) => updates.push(assistant?.text ?? ""), scheduler.schedule, scheduler.cancel);

  stream.append({ id: "chat-1", sessionId: "session-1", text: "Hello" });
  const finished = stream.finish("chat-1", "Hello world");
  drain(scheduler);
  await finished;

  assert.equal(updates.at(-1), "Hello world");
  assert.ok(updates.includes("Hello"));
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
  drain(scheduler);
  assert.equal(updates.at(-1), "Hello world");

  let settled = false;
  const finished = stream.finish("chat-1", "Hello").then(() => { settled = true; });
  drain(scheduler, 3);
  await Promise.resolve();
  assert.equal(settled, true);
  await finished;

  assert.equal(updates.at(-1), "Hello");
  stream.clear("chat-1");
  assert.equal(updates.at(-1), "");
});

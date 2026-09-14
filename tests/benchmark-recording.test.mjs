import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkRecorderAvailable, requireBenchmarkEvent } from "../extension/background/benchmark-client.ts";
import { benchmarkChat } from "../shared/benchmark-chat.ts";
import { saveChat, loadChatHistory } from "../extension/sidepanel/src/chat-history.ts";

test("a run requires acknowledgement and surfaces a stopped or occupied recorder", async () => {
  const previous = globalThis.fetch;
  const event = { type: "run_started", runId: "three-tabs", tabCount: 3, timestamp: Date.now() };
  try {
    globalThis.fetch = async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), event);
      return new Response(null, { status: 204 });
    };
    await requireBenchmarkEvent(event);
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    await assert.rejects(requireBenchmarkEvent(event), /Start pnpm benchmark:memory/);
    globalThis.fetch = async () => new Response(null, { status: 400 });
    await assert.rejects(requireBenchmarkEvent(event), /Each report needs a new recorder/);
  } finally { globalThis.fetch = previous; }
});

test("recorder status is only available while the benchmark server responds", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "http://127.0.0.1:7332/events");
      assert.equal(options.method, "OPTIONS");
      return new Response(null, { status: 204 });
    };
    assert.equal(await benchmarkRecorderAvailable(), true);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal(await benchmarkRecorderAvailable(), false);
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    assert.equal(await benchmarkRecorderAvailable(), false);
  } finally { globalThis.fetch = previous; }
});

test("three parallel benchmark replies are saved with the matching prompt and page", async () => {
  const previous = globalThis.chrome;
  let stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async (value) => { stored = structuredClone(value); },
  } } };
  try {
    const tabs = ["YouTube", "Hacker News", "Reddit"].map((title, id) => ({ id, windowId: 1, title, url: `https://site${id}.test/` }));
    await Promise.all(tabs.map((tab) => saveChat(benchmarkChat(`benchmark-${tab.id}`, "Read this page", tab, 100))));
    assert.equal((await loadChatHistory()).length, 3);
    await Promise.all(tabs.map((tab) => saveChat(benchmarkChat(`benchmark-${tab.id}`, "Read this page", tab, 100, `Reply for ${tab.title}`))));
    const history = await loadChatHistory();
    assert.equal(history.length, 3);
    for (const tab of tabs) {
      const chat = history.find((item) => item.id === `benchmark-${tab.id}`);
      assert.equal(chat.title, `Memory test: ${tab.title}`);
      assert.equal(chat.status, "completed");
      assert.deepEqual(chat.items.map((item) => item.text), ["Read this page", `Reply for ${tab.title}`]);
      assert.deepEqual(chat.links, [tab.url]);
    }
  } finally { globalThis.chrome = previous; }
});

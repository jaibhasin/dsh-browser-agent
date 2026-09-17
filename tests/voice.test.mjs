import assert from "node:assert/strict";
import test from "node:test";
import { canStartVoice, parseVoiceConfig, voiceProviderRequiresKey } from "../shared/voice.ts";
import { ensureVoicePermission } from "../extension/sidepanel/src/voice-permission.ts";

test("voice config accepts browser dictation without a key", () => {
  assert.deepEqual(parseVoiceConfig({ version: 1, provider: "browser", apiKey: "ignored" }), { version: 1, provider: "browser" });
  assert.equal(voiceProviderRequiresKey("browser"), false);
});

test("voice config accepts supported cloud providers and keeps their key", () => {
  for (const provider of ["groq", "openrouter", "deepgram", "elevenlabs"]) {
    assert.deepEqual(parseVoiceConfig({ version: 1, provider, apiKey: "secret" }), { version: 1, provider, apiKey: "secret" });
    assert.equal(voiceProviderRequiresKey(provider), true);
  }
});

test("voice config rejects malformed or oversized credentials", () => {
  assert.equal(parseVoiceConfig(undefined), undefined);
  assert.equal(parseVoiceConfig({ version: 2, provider: "browser" }), undefined);
  assert.equal(parseVoiceConfig({ version: 1, provider: "unknown" }), undefined);
  assert.equal(parseVoiceConfig({ version: 1, provider: "groq", apiKey: "x".repeat(513) }), undefined);
});

test("voice input can be retried after a recoverable error", () => {
  assert.equal(canStartVoice("idle"), true);
  assert.equal(canStartVoice("error"), true);
  assert.equal(canStartVoice("listening"), false);
  assert.equal(canStartVoice("transcribing"), false);
});

test("microphone permission is requested in an extension tab, never in the side panel", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousChrome = globalThis.chrome;
  let state = "prompt";
  let tabs = [];
  const created = [];
  const focused = [];
  const url = "chrome-extension://test/sidepanel/microphone.html";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    permissions: { query: async (query) => { assert.equal(query.name, "microphone"); return { state }; } },
    mediaDevices: { getUserMedia: () => assert.fail("Side panel must not request microphone before permission") },
  } });
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    tabs: {
      query: async () => tabs,
      create: async (options) => { created.push(options); },
      update: async (id, options) => { focused.push({ id, ...options }); },
    },
  };
  try {
    assert.equal(await ensureVoicePermission(), false);
    assert.deepEqual(created, [{ url, active: true }]);
    state = "denied";
    tabs = [{ id: 7, url }];
    assert.equal(await ensureVoicePermission(), false);
    assert.deepEqual(focused, [{ id: 7, active: true }]);
    state = "granted";
    assert.equal(await ensureVoicePermission(), true);
    assert.equal(created.length, 1);
    assert.equal(focused.length, 1);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
    globalThis.chrome = previousChrome;
  }
});

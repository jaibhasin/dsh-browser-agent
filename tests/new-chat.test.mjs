import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const controllerUrl = new URL("../extension/sidepanel/src/hooks/useSidepanelController.ts", import.meta.url);
const requireFromController = createRequire(controllerUrl);
const source = await readFile(controllerUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const toolsUrl = new URL("../extension/sidepanel/src/tools.ts", import.meta.url);
const tools = {};
new Function("require", "exports", ts.transpileModule(await readFile(toolsUrl, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)((name) => createRequire(toolsUrl)(`${name}.ts`), tools);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const savedChat = {
  id: "previous-chat", title: "Previous task", createdAt: 1, updatedAt: 2,
  status: "completed", links: [],
  items: [{ kind: "message", id: "old-message", role: "user", text: "Previous task" }],
};

function setup() {
  // Keep state and refs across renders, while leaving mount effects out of
  // these click-handler tests. Compile the real controller as other tests do
  // for browser scripts; no separate copy of the session logic is exercised.
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() {},
  };
  const deletion = deferred();
  const removals = [];
  const messages = [];
  let handleMessage = async () => ({ ok: true, state: { activeTaskCount: 0 } });
  globalThis.chrome = {
    runtime: { sendMessage(message) { messages.push(message); return handleMessage(message); } },
    storage: { local: { async set() {} } },
  };
  const overrides = {
    react,
    "../tools": tools,
    "../chat-history": {
      ...requireFromController("../chat-history.ts"),
      removeChat(id) { removals.push(id); return deletion.promise; },
    },
    "../assistant-stream": { createAssistantStream: () => ({ clear() {} }) },
    "./useAttachments": {
      useAttachments() {
        const [draftImages, setDraftImages] = react.useState([]);
        const [draftDocuments, setDraftDocuments] = react.useState([]);
        return { draftImages, setDraftImages, draftDocuments, setDraftDocuments };
      },
    },
    "./useThemePreference": { useThemePreference: () => ({ themePreference: "system" }) },
    "./useToolSettings": {
      useToolSettings() {
        const [toolSettings, updateToolSettings] = react.useState({ version: 3, deniedDefault: [], deniedByChat: {} });
        return { toolSettings, updateToolSettings, effectiveDeniedTools: [] };
      },
    },
    "./useVoiceInput": { useVoiceInput: () => ({}) },
  };
  const exports = {};
  new Function("require", "exports", compiled)(
    (name) => overrides[name] ?? requireFromController(`${name}.ts`), exports,
  );
  return {
    deletion, removals, messages,
    respondWith(handler) { handleMessage = handler; },
    render() { cursor = 0; return exports.useSidepanelController("system"); },
  };
}

async function openPreviousChat(harness) {
  harness.render().chatHistory.openSavedChat(savedChat);
  await flush();
  const panel = harness.render();
  assert.equal(panel.conversation.activeSessionId, savedChat.id);
  assert.equal(panel.conversation.messages.length, 1);
  harness.messages.length = 0;
  return panel;
}

test("one click clears the conversation before cancellation or queued storage finishes", async () => {
  const harness = setup();
  let panel = await openPreviousChat(harness);
  panel.panelHeader.setIsHistoryOpen(true);
  panel.composer.setPrompt("Unsent draft");
  panel.composer.setDraftImages([{ id: "image" }]);
  panel.composer.setDraftDocuments([{ id: "document" }]);
  panel = harness.render();
  let focused = false;
  panel.composer.textareaRef.current = { focus() { focused = true; } };
  const cancellation = deferred();
  const claim = deferred();
  const refresh = deferred();
  harness.respondWith((message) => {
    if (message.type === "dsh-agent-discard-chat") return cancellation.promise;
    if (message.type === "dsh-agent-claim-tab") return claim.promise;
    if (message.type === "dsh-agent-tab-state-request") return refresh.promise;
    return Promise.resolve({ ok: true });
  });
  const start = panel.panelHeader.startNewSession;
  const starting = start();
  // Same-render clicks must also be ignored, before React updates the button.
  await start();
  panel = harness.render();
  const sessionId = panel.conversation.activeSessionId;
  assert.notEqual(sessionId, savedChat.id);
  assert.deepEqual(panel.conversation.messages, []);
  assert.equal(panel.composer.prompt, "");
  assert.deepEqual(panel.composer.draftImages, []);
  assert.deepEqual(panel.composer.draftDocuments, []);
  assert.equal(panel.panelHeader.isHistoryOpen, false);
  assert.equal(panel.panelHeader.isStartingSession, true);
  assert.equal(focused, true);
  assert.deepEqual(harness.removals, [savedChat.id]);
  assert.deepEqual(harness.messages.map((message) => message.type), ["dsh-agent-discard-chat"]);

  cancellation.resolve({ ok: true });
  await flush();
  await harness.render().panelHeader.startNewSession();
  assert.equal(harness.render().panelHeader.isStartingSession, true);
  assert.equal(harness.messages.filter((message) => message.type === "dsh-agent-claim-tab").length, 1);
  claim.resolve({ ok: true });
  await flush();
  assert.equal(harness.render().panelHeader.isStartingSession, true);
  refresh.resolve({ ok: true, state: { activeTaskCount: 0 } });
  // Storage remains unresolved, but session setup can finish independently.
  await starting;
  assert.equal(harness.render().panelHeader.isStartingSession, false);
  assert.equal(harness.render().conversation.activeSessionId, sessionId);
  assert.match(harness.render().conversation.sessionNotice, /New chat ready/);
  harness.deletion.resolve();
});

test("messages cannot be submitted until the new tab claim finishes", async () => {
  const harness = setup();
  const claim = deferred();
  harness.respondWith((message) => message.type === "dsh-agent-claim-tab"
    ? claim.promise : Promise.resolve({ ok: true, state: { activeTaskCount: 0 } }));
  const starting = harness.render().panelHeader.startNewSession();
  await flush();
  harness.render().composer.setPrompt("Start another task");
  const panel = harness.render();
  await panel.composer.sendMessage({ preventDefault() {} });
  assert.equal(panel.composer.isStartingSession, true);
  assert.ok(!harness.messages.some((message) => message.type === "dsh-chat"));
  claim.resolve({ ok: true });
  await starting;
  harness.deletion.resolve();
});

for (const failingType of ["dsh-agent-claim-tab", "dsh-agent-tab-state-request"]) {
  test(`a rejected ${failingType} reports the error and allows retry`, async () => {
    const harness = setup();
    harness.respondWith((message) => message.type === failingType
      ? Promise.reject(new Error("Worker unavailable"))
      : Promise.resolve({ ok: true, state: { activeTaskCount: 0 } }));
    await harness.render().panelHeader.startNewSession();
    assert.equal(harness.render().panelHeader.isStartingSession, false);
    assert.match(harness.render().conversation.sessionNotice, /Worker unavailable/);
    harness.respondWith(async () => ({ ok: true, state: { activeTaskCount: 0 } }));
    await harness.render().panelHeader.startNewSession();
    assert.match(harness.render().conversation.sessionNotice, /New chat ready/);
    harness.deletion.resolve();
  });
}

test("storage failure does not prevent creation of the next chat", async () => {
  const harness = setup();
  const panel = await openPreviousChat(harness);
  const starting = panel.panelHeader.startNewSession();
  harness.deletion.reject(new Error("Storage unavailable"));
  await starting;
  assert.equal(harness.render().panelHeader.isStartingSession, false);
  assert.notEqual(harness.render().conversation.activeSessionId, savedChat.id);
  assert.deepEqual(harness.render().conversation.messages, []);
});

test("a delayed state response for the previous chat cannot replace the new chat's tab", async () => {
  const harness = setup();
  const oldState = deferred();
  harness.respondWith((message) => message.type === "dsh-agent-tab-state-request" && message.sessionId === savedChat.id
    ? oldState.promise : Promise.resolve({ ok: true, state: { activeTaskCount: 0, agentTabId: 42 } }));
  harness.render().chatHistory.openSavedChat(savedChat);
  await flush();
  await harness.render().panelHeader.startNewSession();
  oldState.resolve({ ok: true, state: { activeTaskCount: 1, agentTabId: 7 } });
  await flush();
  assert.equal(harness.render().agentTabState.agentTabId, 42);
  harness.deletion.resolve();
});

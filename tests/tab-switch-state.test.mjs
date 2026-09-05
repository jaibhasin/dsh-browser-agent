import assert from "node:assert/strict";

const { getTabSwitchView } = await import("../extension/sidepanel/src/tab-switch-state.ts");

const amazon = { id: 42, title: "Amazon" };
const gmail = { id: 77, title: "Gmail" };
const saved = new Set(["session-gmail"]);

function view(state, options = {}) {
  return getTabSwitchView({
    state: { activeTaskCount: 0, currentTab: gmail, ...state },
    activeSessionId: "session-amazon",
    savedSessionIds: saved,
    historyReady: true,
    ...options,
  });
}

assert.deepEqual(view({ agentTabId: 42, agentTab: amazon }), {
  kind: "new-tab",
  tab: gmail,
}, "an inactive chat moving to an empty tab must offer a new chat");

assert.deepEqual(view({
  agentTabId: 42,
  agentTab: amazon,
  task: { status: "paused", tabId: 42, runMode: "foreground", pendingTabId: 77 },
}), {
  kind: "active-task",
  tab: gmail,
}, "foreground work must be resolved before changing chats");

assert.deepEqual(view({
  agentTabId: 42,
  agentTab: amazon,
  currentTabSessionId: "session-gmail",
  task: { status: "paused", tabId: 42, runMode: "foreground", pendingTabId: 77 },
}), {
  kind: "active-task",
  tab: gmail,
}, "active work must be resolved before offering the destination's saved chat");

assert.deepEqual(view({
  agentTabId: 42,
  agentTab: amazon,
  currentTabSessionId: "session-gmail",
}), {
  kind: "saved-chat",
  tab: gmail,
  sessionId: "session-gmail",
}, "returning to an owned tab must offer its saved chat");

assert.deepEqual(view({
  currentTabSessionId: "session-gmail",
}), {
  kind: "saved-chat",
  tab: gmail,
  sessionId: "session-gmail",
}, "a fresh panel session must still detect the current tab's saved chat");

assert.deepEqual(view({
  agentTabId: 42,
  agentTab: amazon,
  task: { status: "running", tabId: 42, runMode: "background" },
}), {
  kind: "new-tab",
  tab: gmail,
}, "background work must allow a separate chat on the visible tab");

assert.deepEqual(view({
  agentTabId: 42,
  agentTab: amazon,
  currentTab: amazon,
}), { kind: "none" }, "the chat's assigned tab must not show a switch prompt");

assert.deepEqual(view({ agentTabId: 42, agentTab: amazon }, { dismissedTabId: 77 }), {
  kind: "none",
}, "keeping the current chat must dismiss the prompt for this tab");

assert.deepEqual(view({ currentTabSessionId: "session-gmail" }, { historyReady: false }), {
  kind: "none",
}, "the panel must wait for history before deciding a saved assignment is stale");

process.stdout.write("tab switch state scenarios passed\n");

import assert from "node:assert/strict";

const tabs = new Map([
  [42, { id: 42, windowId: 1, title: "Amazon", url: "https://amazon.example", active: true, groupId: -1 }],
  [77, { id: 77, windowId: 1, title: "Gmail", url: "https://gmail.example", active: false, groupId: -1 }],
]);
const session = {};
let nextGroupId = 100;
const ungrouped = [];

globalThis.chrome = {
  storage: {
    session: {
      async get(key) { return { [key]: session[key] }; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; },
    },
  },
  tabs: {
    TAB_ID_NONE: -1,
    async query(query) { return [...tabs.values()].filter((tab) => !query.active || tab.active); },
    async get(id) {
      const tab = tabs.get(id);
      if (!tab) throw new Error("missing");
      return tab;
    },
    async group({ tabIds, groupId }) {
      const tab = tabs.get(tabIds);
      if (!tab) throw new Error("missing");
      tab.groupId = groupId ?? nextGroupId++;
      return tab.groupId;
    },
    async ungroup(id) {
      tabs.get(id).groupId = -1;
      ungrouped.push(id);
    },
  },
  tabGroups: { async update() {} },
  runtime: { async sendMessage() {} },
};

const { cancelAgentTask, ensureAgentTab, endAgentTask, getAgentTabState, getAgentTaskTab, pauseAgentTaskForTab, releaseAgentTab, resumeAgentTask, startAgentTask, switchAgentTab } = await import("../extension/background/agent-tab.ts");

assert.equal((await ensureAgentTab()).id, 42, "first task should claim Amazon");
assert.equal(session.dshAgentTab.tabId, 42);
assert.equal(tabs.get(42).groupId, 100, "claimed tab should receive the colored group");

// Chrome sends the activated tab ID before every observer has necessarily
// reflected it in a broad active-tab query. The event's tab must win.
assert.deepEqual(await getAgentTabState(tabs.get(77)), {
  agentTabId: 42,
  agentTab: { id: 42, windowId: 1, title: "Amazon", url: "https://amazon.example" },
  currentTab: { id: 77, windowId: 1, title: "Gmail", url: "https://gmail.example" },
}, "the switch prompt must receive the tab from Chrome's activation event");

await startAgentTask("shopping-task", 42);
await pauseAgentTaskForTab(77);
assert.equal((await getAgentTabState()).task?.status, "paused", "leaving the agent tab should pause its task");

let resumed = false;
const waitingTask = getAgentTaskTab("shopping-task").then((tab) => {
  resumed = true;
  return tab;
});
await Promise.resolve();
assert.equal(resumed, false, "browser actions must wait for the user's choice");
await resumeAgentTask();
assert.equal((await waitingTask).id, 42, "keeping the task must resume it on its original tab");

await pauseAgentTaskForTab(77);
const cancelledTask = getAgentTaskTab("shopping-task");
await Promise.resolve();
await cancelAgentTask();
await assert.rejects(cancelledTask, /stopped/, "switching tabs must stop the paused task");
await endAgentTask("shopping-task");

tabs.get(42).active = false;
tabs.get(77).active = true;
assert.equal((await ensureAgentTab()).id, 42, "switching visible tabs must not retarget the agent");
assert.deepEqual(await getAgentTabState(), {
  agentTabId: 42,
  agentTab: { id: 42, windowId: 1, title: "Amazon", url: "https://amazon.example" },
  currentTab: { id: 77, windowId: 1, title: "Gmail", url: "https://gmail.example" },
});

await switchAgentTab(77);
assert.equal(session.dshAgentTab.tabId, 77, "explicit switch should retarget the agent");
assert.equal(tabs.get(42).groupId, -1, "explicit switch should remove the old marker");
assert.equal(tabs.get(77).groupId, 101, "explicit switch should mark the new tab");

await releaseAgentTab();
assert.equal(session.dshAgentTab, undefined, "new session should clear ownership");
assert.deepEqual(ungrouped, [42, 77], "both moved-from tabs should have their markers removed");

process.stdout.write("agent tab ownership scenarios passed\n");

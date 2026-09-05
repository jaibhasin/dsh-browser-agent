import assert from "node:assert/strict";

const tabs = new Map([
  [42, { id: 42, windowId: 1, title: "Amazon", url: "https://amazon.example", active: true, groupId: -1 }],
  [77, { id: 77, windowId: 1, title: "Gmail", url: "https://gmail.example", active: false, groupId: -1 }],
]);
const session = {};
const local = {};
let nextGroupId = 100;
const ungrouped = [];

function storage(store) {
  return {
    async get(keys) {
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
      return { [keys]: store[keys] };
    },
    async set(values) { Object.assign(store, values); },
    async remove(key) { delete store[key]; },
  };
}

globalThis.chrome = {
  storage: { session: storage(session), local: storage(local) },
  tabs: {
    TAB_ID_NONE: -1,
    async query(query) { return [...tabs.values()].filter((tab) => !query.active || tab.active); },
    async get(id) { const tab = tabs.get(id); if (!tab) throw new Error("missing"); return tab; },
    async group({ tabIds, groupId }) { const tab = tabs.get(tabIds); if (!tab) throw new Error("missing"); tab.groupId = groupId ?? nextGroupId++; return tab.groupId; },
    async ungroup(id) { tabs.get(id).groupId = -1; ungrouped.push(id); },
    async update(id, values) { Object.assign(tabs.get(id), values); return tabs.get(id); },
    async create(values) { const tab = { id: 88, windowId: 1, title: "Restored", url: values.url, active: true, groupId: -1 }; tabs.set(88, tab); return tab; },
  },
  windows: { async update() {} },
  tabGroups: { async update() {} },
  runtime: { async sendMessage() {} },
};

const api = await import("../extension/background/agent-tab.ts");
const amazonChat = "session-amazon";
const gmailChat = "session-gmail";

assert.equal((await api.ensureAgentTab(amazonChat)).id, 42);
assert.equal(local.dshAgentTabs[amazonChat].tabId, 42, "tab ownership must be persisted beyond a service worker lifetime");
assert.equal(tabs.get(42).groupId, 100);

assert.deepEqual(await api.getAgentTabState(amazonChat, tabs.get(77)), {
  agentTabId: 42,
  agentTab: { id: 42, windowId: 1, title: "Amazon", url: "https://amazon.example" },
  currentTab: { id: 77, windowId: 1, title: "Gmail", url: "https://gmail.example" },
  activeTaskCount: 0,
});

await api.startAgentTask("shopping-task", amazonChat, 42);
await api.startAgentTask("mail-task", gmailChat, 77);
await api.continueAgentTaskInBackground(gmailChat);
assert.equal((await api.getAgentTabState(amazonChat)).activeTaskCount, 2, "two chats must keep independent active tasks");
assert.equal((await api.getAgentTaskTab("shopping-task")).id, 42);
assert.equal((await api.getAgentTaskTab("mail-task")).id, 77);

await api.pauseAgentTaskForTab(77);
assert.equal((await api.getAgentTabState(amazonChat)).task?.status, "paused");
assert.equal((await api.getAgentTabState(gmailChat)).task?.status, "running");
await api.continueAgentTaskInBackground(amazonChat);
assert.equal((await api.getAgentTaskTab("shopping-task")).id, 42);
await api.pauseAgentTaskForTab(77);
assert.equal((await api.getAgentTabState(amazonChat)).task?.runMode, "background", "background work must not pause on another tab activation");

// A tab can have one owner only.  A new claim removes the previous chat's
// assignment, while higher layers decide whether to delete its saved history.
const claimed = await api.claimAgentTab(gmailChat, tabs.get(42));
assert.deepEqual(claimed.displacedSessionIds, [amazonChat]);
assert.equal(await api.getAgentSessionForTab(42), gmailChat);
assert.equal(local.dshAgentTabs[amazonChat], undefined);
assert.equal(local.dshAgentTabs[gmailChat].tabId, 42);

await api.moveAgentTaskToTab(gmailChat, 42);
assert.equal((await api.getAgentTaskTab("mail-task")).id, 42);
await api.cancelAgentTask(amazonChat);
assert.equal((await api.getAgentTabState(amazonChat)).task?.status, "cancelled");
assert.equal((await api.getAgentTabState(gmailChat)).activeTaskCount, 1);
await api.endAgentTask("mail-task");
await api.endAgentTask("shopping-task");
assert.equal((await api.getAgentTabState(gmailChat)).activeTaskCount, 0);

await api.releaseAgentTab(gmailChat);
assert.equal(local.dshAgentTabs[gmailChat], undefined);
assert.ok(ungrouped.includes(42));
process.stdout.write("agent tab ownership scenarios passed\n");

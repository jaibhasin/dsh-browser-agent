const STORAGE_KEY = "dshAgentTab";
const TASK_STORAGE_KEY = "dshAgentTask";
const INDICATOR_TITLE = "Agent";

type StoredAgentTab = {
  tabId: number;
  indicatorGroupId?: number;
  originalGroupId?: number;
};

type StoredAgentTask = {
  id: string;
  tabId: number;
  status: "running" | "paused" | "cancelled";
  pendingTabId?: number;
};

type TaskWaiter = { resolve: () => void; reject: (error: Error) => void };
const taskWaiters = new Map<string, TaskWaiter[]>();

export type AgentTabState = {
  agentTabId?: number;
  agentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  currentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  task?: Pick<StoredAgentTask, "status" | "tabId" | "pendingTabId">;
};

async function readStoredAgentTab(): Promise<StoredAgentTab | undefined> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const value = result[STORAGE_KEY] as Partial<StoredAgentTab> | undefined;
  return Number.isInteger(value?.tabId) ? value as StoredAgentTab : undefined;
}

async function writeStoredAgentTab(value?: StoredAgentTab): Promise<void> {
  if (value) await chrome.storage.session.set({ [STORAGE_KEY]: value });
  else await chrome.storage.session.remove(STORAGE_KEY);
}

async function readStoredAgentTask(): Promise<StoredAgentTask | undefined> {
  const result = await chrome.storage.session.get(TASK_STORAGE_KEY);
  const value = result[TASK_STORAGE_KEY] as Partial<StoredAgentTask> | undefined;
  return typeof value?.id === "string" && Number.isInteger(value.tabId) &&
    (value.status === "running" || value.status === "paused" || value.status === "cancelled")
    ? value as StoredAgentTask
    : undefined;
}

async function writeStoredAgentTask(value?: StoredAgentTask): Promise<void> {
  if (value) await chrome.storage.session.set({ [TASK_STORAGE_KEY]: value });
  else await chrome.storage.session.remove(TASK_STORAGE_KEY);
}

function settleTaskWaiters(taskId: string, error?: Error): void {
  const waiters = taskWaiters.get(taskId) ?? [];
  taskWaiters.delete(taskId);
  for (const waiter of waiters) {
    if (error) waiter.reject(error);
    else waiter.resolve();
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function addIndicator(tab: chrome.tabs.Tab): Promise<StoredAgentTab> {
  if (tab.id === undefined) throw new Error("The browser returned a tab without an ID.");
  const originalGroupId = tab.groupId;
  let indicatorGroupId: number | undefined;
  try {
    indicatorGroupId = await chrome.tabs.group({ tabIds: tab.id });
    await chrome.tabGroups.update(indicatorGroupId, { color: "blue", title: INDICATOR_TITLE, collapsed: false });
    return { tabId: tab.id, indicatorGroupId, ...(originalGroupId !== chrome.tabs.TAB_ID_NONE ? { originalGroupId } : {}) };
  } catch {
    // Pinning must continue even if this browser does not support tab groups.
    if (indicatorGroupId !== undefined) {
      if (originalGroupId !== chrome.tabs.TAB_ID_NONE) {
        await chrome.tabs.group({ tabIds: tab.id, groupId: originalGroupId }).catch(() => chrome.tabs.ungroup(tab.id!));
      } else {
        await chrome.tabs.ungroup(tab.id).catch(() => undefined);
      }
    }
    return { tabId: tab.id };
  }
}

async function removeIndicator(stored: StoredAgentTab): Promise<void> {
  if (stored.indicatorGroupId === undefined) return;
  const tab = await chrome.tabs.get(stored.tabId).catch(() => undefined);
  if (!tab || tab.groupId !== stored.indicatorGroupId) return;
  try {
    if (stored.originalGroupId !== undefined) {
      await chrome.tabs.group({ tabIds: stored.tabId, groupId: stored.originalGroupId });
    } else {
      await chrome.tabs.ungroup(stored.tabId);
    }
  } catch {
    // The original group may have been closed or changed by the user.
    await chrome.tabs.ungroup(stored.tabId).catch(() => undefined);
  }
}

/** Pins a new agent session to the tab that is active when its first message is sent. */
export async function ensureAgentTab(): Promise<chrome.tabs.Tab> {
  const stored = await readStoredAgentTab();
  if (stored) {
    const tab = await chrome.tabs.get(stored.tabId).catch(() => undefined);
    if (!tab) throw new Error("The tab assigned to this agent was closed. Switch the agent to an open tab or start a new chat.");
    return tab;
  }
  const tab = await activeTab();
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  await writeStoredAgentTab(await addIndicator(tab));
  await broadcastAgentTabState();
  return tab;
}

/** Moves agent ownership only after an explicit side-panel action. */
export async function switchAgentTab(id: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(id).catch(() => undefined);
  if (!tab) throw new Error(`No browser tab exists with ID ${id}.`);
  const old = await readStoredAgentTab();
  if (old?.tabId === id) return tab;
  if (old) await removeIndicator(old);
  await writeStoredAgentTab(await addIndicator(tab));
  await broadcastAgentTabState();
  return tab;
}

export async function releaseAgentTab(): Promise<void> {
  const stored = await readStoredAgentTab();
  if (stored) await removeIndicator(stored);
  await writeStoredAgentTab();
  await broadcastAgentTabState();
}

/** Starts a task lease so every browser action from this chat stays on one tab. */
export async function startAgentTask(id: string, tabId: number): Promise<void> {
  await writeStoredAgentTask({ id, tabId, status: "running" });
  await broadcastAgentTabState();
}

export async function endAgentTask(id: string): Promise<void> {
  const task = await readStoredAgentTask();
  if (task?.id !== id) return;
  settleTaskWaiters(id, new Error("The browser task ended."));
  await writeStoredAgentTask();
  await broadcastAgentTabState();
}

/** Pauses a task when the user leaves its tab, before its next browser action. */
export async function pauseAgentTaskForTab(currentTabId: number): Promise<void> {
  const task = await readStoredAgentTask();
  if (!task || task.status !== "running" || task.tabId === currentTabId) return;
  await writeStoredAgentTask({ ...task, status: "paused", pendingTabId: currentTabId });
}

/** Resolves the fixed tab lease for a tool request, waiting while the user decides. */
export async function getAgentTaskTab(id: string): Promise<chrome.tabs.Tab> {
  while (true) {
    const task = await readStoredAgentTask();
    if (!task || task.id !== id) throw new Error("This browser task is no longer active.");
    if (task.status === "cancelled") throw new Error("This browser task was stopped when the agent tab changed.");
    if (task.status === "running") {
      const tab = await chrome.tabs.get(task.tabId).catch(() => undefined);
      if (!tab) throw new Error("The tab assigned to this browser task was closed.");
      return tab;
    }
    await new Promise<void>((resolve, reject) => {
      const waiters = taskWaiters.get(id) ?? [];
      waiters.push({ resolve, reject });
      taskWaiters.set(id, waiters);
    });
  }
}

export async function resumeAgentTask(): Promise<void> {
  const task = await readStoredAgentTask();
  if (!task || task.status !== "paused") return;
  await writeStoredAgentTask({ id: task.id, tabId: task.tabId, status: "running" });
  settleTaskWaiters(task.id);
  await broadcastAgentTabState();
}

export async function cancelAgentTask(): Promise<string | undefined> {
  const task = await readStoredAgentTask();
  if (!task || task.status === "cancelled") return undefined;
  await writeStoredAgentTask({ ...task, status: "cancelled" });
  settleTaskWaiters(task.id, new Error("This browser task was stopped when the agent tab changed."));
  await broadcastAgentTabState();
  return task.id;
}

export async function getAgentTabState(currentTabOverride?: chrome.tabs.Tab): Promise<AgentTabState> {
  const [stored, task, currentTab] = await Promise.all([
    readStoredAgentTab(),
    readStoredAgentTask(),
    currentTabOverride === undefined ? activeTab() : Promise.resolve(currentTabOverride),
  ]);
  const agentTab = stored ? await chrome.tabs.get(stored.tabId).catch(() => undefined) : undefined;
  return {
    ...(stored ? { agentTabId: stored.tabId } : {}),
    ...(agentTab ? { agentTab: summarizeTab(agentTab) } : {}),
    ...(currentTab ? { currentTab: summarizeTab(currentTab) } : {}),
    ...(task ? { task: { status: task.status, tabId: task.tabId, ...(task.pendingTabId !== undefined ? { pendingTabId: task.pendingTabId } : {}) } } : {}),
  };
}

export async function broadcastAgentTabState(currentTabId?: number): Promise<void> {
  const currentTab = currentTabId === undefined
    ? undefined
    : await chrome.tabs.get(currentTabId).catch(() => undefined);
  const state = await getAgentTabState(currentTab);
  await chrome.runtime.sendMessage({ type: "dsh-agent-tab-state", state }).catch(() => undefined);
}

function summarizeTab(tab: chrome.tabs.Tab): Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId"> {
  return { id: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId };
}

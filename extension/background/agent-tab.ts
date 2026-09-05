const STORAGE_KEY = "dshAgentTabs";
const TASK_STORAGE_KEY = "dshAgentTask";
const INDICATOR_TITLE = "Agent";

type StoredAgentTab = {
  tabId: number;
  indicatorGroupId?: number;
  originalGroupId?: number;
};
type StoredAgentTabs = Record<string, StoredAgentTab>;

type StoredAgentTask = {
  id: string;
  sessionId: string;
  tabId: number;
  status: "running" | "paused" | "cancelled";
  runMode: "foreground" | "background";
  pendingTabId?: number;
};

type TaskWaiter = { resolve: () => void; reject: (error: Error) => void };
const taskWaiters = new Map<string, TaskWaiter[]>();

export type AgentTabState = {
  agentTabId?: number;
  agentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  currentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  task?: Pick<StoredAgentTask, "status" | "tabId" | "runMode" | "pendingTabId">;
  activeTaskCount: number;
};

async function readStoredAgentTabs(): Promise<StoredAgentTabs> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) =>
    !!candidate && typeof candidate === "object" && Number.isInteger((candidate as Partial<StoredAgentTab>).tabId),
  )) as StoredAgentTabs;
}

async function writeStoredAgentTabs(value: StoredAgentTabs): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: value });
}

async function readStoredAgentTask(): Promise<StoredAgentTask | undefined> {
  const result = await chrome.storage.session.get(TASK_STORAGE_KEY);
  const value = result[TASK_STORAGE_KEY] as Partial<StoredAgentTask> | undefined;
  return typeof value?.id === "string" && typeof value.sessionId === "string" && Number.isInteger(value.tabId) &&
    (value.status === "running" || value.status === "paused" || value.status === "cancelled")
    ? { ...value, runMode: value.runMode === "background" ? "background" : "foreground" } as StoredAgentTask
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
export async function ensureAgentTab(sessionId: string): Promise<chrome.tabs.Tab> {
  const tabs = await readStoredAgentTabs();
  const stored = tabs[sessionId];
  if (stored) {
    const tab = await chrome.tabs.get(stored.tabId).catch(() => undefined);
    if (!tab) throw new Error("The tab assigned to this agent was closed. Switch the agent to an open tab or start a new chat.");
    return tab;
  }
  const tab = await activeTab();
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  tabs[sessionId] = await addIndicator(tab);
  await writeStoredAgentTabs(tabs);
  await broadcastAgentTabState(sessionId);
  return tab;
}

/** Moves agent ownership only after an explicit side-panel action. */
export async function switchAgentTab(sessionId: string, id: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(id).catch(() => undefined);
  if (!tab) throw new Error(`No browser tab exists with ID ${id}.`);
  const tabs = await readStoredAgentTabs();
  const old = tabs[sessionId];
  if (old?.tabId === id) return tab;
  if (old) await removeIndicator(old);
  tabs[sessionId] = await addIndicator(tab);
  await writeStoredAgentTabs(tabs);
  await broadcastAgentTabState(sessionId);
  return tab;
}

export async function releaseAgentTab(sessionId: string): Promise<void> {
  const tabs = await readStoredAgentTabs();
  const stored = tabs[sessionId];
  if (stored) await removeIndicator(stored);
  delete tabs[sessionId];
  await writeStoredAgentTabs(tabs);
  await broadcastAgentTabState(sessionId);
}

/** Activates a saved chat's tab, or recreates it from its last recorded website. */
export async function focusOrRestoreAgentTab(sessionId: string, fallbackUrl?: string): Promise<chrome.tabs.Tab> {
  const tabs = await readStoredAgentTabs();
  const stored = tabs[sessionId];
  const existing = stored ? await chrome.tabs.get(stored.tabId).catch(() => undefined) : undefined;
  if (existing?.id !== undefined && existing.windowId !== undefined) {
    await chrome.windows.update(existing.windowId, { focused: true });
    return await chrome.tabs.update(existing.id, { active: true });
  }
  const url = validHttpUrl(fallbackUrl) ? fallbackUrl : undefined;
  const tab = await chrome.tabs.create(url ? { url, active: true } : { active: true });
  if (tab.id === undefined) throw new Error("The browser could not create a tab for this saved chat.");
  if (stored) {
    tabs[sessionId] = await addIndicator(tab);
    await writeStoredAgentTabs(tabs);
  } else {
    tabs[sessionId] = await addIndicator(tab);
    await writeStoredAgentTabs(tabs);
  }
  await broadcastAgentTabState(sessionId, tab.id);
  return tab;
}

/** Starts a task lease so every browser action from this chat stays on one tab. */
export async function startAgentTask(id: string, sessionId: string, tabId: number): Promise<void> {
  await writeStoredAgentTask({ id, sessionId, tabId, status: "running", runMode: "foreground" });
  await broadcastAgentTabState(sessionId);
}

export async function endAgentTask(id: string): Promise<void> {
  const task = await readStoredAgentTask();
  if (task?.id !== id) return;
  settleTaskWaiters(id, new Error("The browser task ended."));
  await writeStoredAgentTask();
  await broadcastAgentTabState(task.sessionId);
}

/** Pauses a task when the user leaves its tab, before its next browser action. */
export async function pauseAgentTaskForTab(currentTabId: number): Promise<void> {
  const task = await readStoredAgentTask();
  if (!task || task.status !== "running" || task.runMode === "background" || task.tabId === currentTabId) return;
  await writeStoredAgentTask({ ...task, status: "paused", pendingTabId: currentTabId });
  await broadcastAgentTabState(task.sessionId, currentTabId);
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
  await writeStoredAgentTask({ id: task.id, sessionId: task.sessionId, tabId: task.tabId, status: "running", runMode: "foreground" });
  settleTaskWaiters(task.id);
  await broadcastAgentTabState(task.sessionId);
}

/** Lets a paused task continue on its assigned tab while the user visits other tabs. */
export async function continueAgentTaskInBackground(): Promise<void> {
  const task = await readStoredAgentTask();
  if (!task || task.status === "cancelled") return;
  await writeStoredAgentTask({ id: task.id, sessionId: task.sessionId, tabId: task.tabId, status: "running", runMode: "background" });
  settleTaskWaiters(task.id);
  await broadcastAgentTabState(task.sessionId);
}

export async function cancelAgentTask(sessionId?: string): Promise<string | undefined> {
  const task = await readStoredAgentTask();
  if (!task || task.status === "cancelled" || (sessionId !== undefined && task.sessionId !== sessionId)) return undefined;
  await writeStoredAgentTask({ ...task, status: "cancelled" });
  settleTaskWaiters(task.id, new Error("This browser task was stopped when the agent tab changed."));
  await broadcastAgentTabState(task.sessionId);
  return task.id;
}

/** Retargets an active chat only after the user explicitly moves it. */
export async function moveAgentTaskToTab(sessionId: string, tabId: number): Promise<void> {
  const task = await readStoredAgentTask();
  if (!task || task.sessionId !== sessionId || task.status === "cancelled") return;
  await writeStoredAgentTask({ ...task, tabId, status: "running", runMode: "foreground", pendingTabId: undefined });
  settleTaskWaiters(task.id);
  await broadcastAgentTabState(sessionId);
}

export async function getAgentTabState(sessionId: string, currentTabOverride?: chrome.tabs.Tab): Promise<AgentTabState> {
  const [tabs, task, currentTab] = await Promise.all([
    readStoredAgentTabs(),
    readStoredAgentTask(),
    currentTabOverride === undefined ? activeTab() : Promise.resolve(currentTabOverride),
  ]);
  const stored = tabs[sessionId];
  const agentTab = stored ? await chrome.tabs.get(stored.tabId).catch(() => undefined) : undefined;
  return {
    ...(stored ? { agentTabId: stored.tabId } : {}),
    ...(agentTab ? { agentTab: summarizeTab(agentTab) } : {}),
    ...(currentTab ? { currentTab: summarizeTab(currentTab) } : {}),
    ...(task?.sessionId === sessionId ? { task: { status: task.status, tabId: task.tabId, runMode: task.runMode, ...(task.pendingTabId !== undefined ? { pendingTabId: task.pendingTabId } : {}) } } : {}),
    activeTaskCount: task && task.status === "running" ? 1 : 0,
  };
}

export async function broadcastAgentTabState(sessionId?: string, currentTabId?: number): Promise<void> {
  const task = await readStoredAgentTask();
  const targetSessionId = sessionId ?? task?.sessionId;
  if (!targetSessionId) return;
  const currentTab = currentTabId === undefined
    ? undefined
    : await chrome.tabs.get(currentTabId).catch(() => undefined);
  const state = await getAgentTabState(targetSessionId, currentTab);
  await chrome.runtime.sendMessage({ type: "dsh-agent-tab-state", sessionId: targetSessionId, state }).catch(() => undefined);
}

function summarizeTab(tab: chrome.tabs.Tab): Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId"> {
  return { id: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId };
}

function validHttpUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

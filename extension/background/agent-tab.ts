const TAB_STORAGE_KEY = "dshAgentTabs";
const TASKS_STORAGE_KEY = "dshAgentTasks";
const LEGACY_TASK_STORAGE_KEY = "dshAgentTask";
const INDICATOR_TITLE = "Agent";

type StoredAgentTab = { tabId: number; indicatorGroupId?: number; originalGroupId?: number };
type StoredAgentTabs = Record<string, StoredAgentTab>;
type StoredAgentTask = {
  id: string;
  sessionId: string;
  tabId: number;
  status: "running" | "paused" | "cancelled";
  runMode: "foreground" | "background";
  pendingTabId?: number;
};
type StoredAgentTasks = Record<string, StoredAgentTask>;
type TaskWaiter = { resolve: () => void; reject: (error: Error) => void };
const taskWaiters = new Map<string, TaskWaiter[]>();

export type AgentTabState = {
  agentTabId?: number;
  agentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  currentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  currentTabSessionId?: string;
  task?: Pick<StoredAgentTask, "status" | "tabId" | "runMode" | "pendingTabId">;
  activeTaskCount: number;
};

function tabStorage(): chrome.storage.StorageArea {
  return chrome.storage.local ?? chrome.storage.session;
}

async function readStoredAgentTabs(): Promise<StoredAgentTabs> {
  const result = await tabStorage().get(TAB_STORAGE_KEY);
  const value = result[TAB_STORAGE_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) =>
    !!candidate && typeof candidate === "object" && Number.isInteger((candidate as Partial<StoredAgentTab>).tabId),
  )) as StoredAgentTabs;
}

async function writeStoredAgentTabs(value: StoredAgentTabs): Promise<void> {
  await tabStorage().set({ [TAB_STORAGE_KEY]: value });
}

function parseTask(candidate: Partial<StoredAgentTask> | undefined): StoredAgentTask | undefined {
  if (typeof candidate?.id !== "string" || typeof candidate.sessionId !== "string" || !Number.isInteger(candidate.tabId)) return undefined;
  if (candidate.status !== "running" && candidate.status !== "paused" && candidate.status !== "cancelled") return undefined;
  return { ...candidate, runMode: candidate.runMode === "background" ? "background" : "foreground" } as StoredAgentTask;
}

async function readStoredAgentTasks(): Promise<StoredAgentTasks> {
  const result = await chrome.storage.session.get([TASKS_STORAGE_KEY, LEGACY_TASK_STORAGE_KEY]);
  const stored = result[TASKS_STORAGE_KEY];
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return Object.fromEntries(Object.entries(stored)
      .map(([sessionId, candidate]) => [sessionId, parseTask(candidate as Partial<StoredAgentTask>)] as const)
      .filter(([, task]) => task !== undefined)) as StoredAgentTasks;
  }
  const legacy = parseTask(result[LEGACY_TASK_STORAGE_KEY] as Partial<StoredAgentTask> | undefined);
  return legacy ? { [legacy.sessionId]: legacy } : {};
}

async function writeStoredAgentTasks(tasks: StoredAgentTasks): Promise<void> {
  await chrome.storage.session.set({ [TASKS_STORAGE_KEY]: tasks });
  await chrome.storage.session.remove(LEGACY_TASK_STORAGE_KEY);
}

function settleTaskWaiters(taskId: string, error?: Error): void {
  const waiters = taskWaiters.get(taskId) ?? [];
  taskWaiters.delete(taskId);
  for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
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
    if (indicatorGroupId !== undefined) {
      if (originalGroupId !== chrome.tabs.TAB_ID_NONE) await chrome.tabs.group({ tabIds: tab.id, groupId: originalGroupId }).catch(() => chrome.tabs.ungroup(tab.id!));
      else await chrome.tabs.ungroup(tab.id).catch(() => undefined);
    }
    return { tabId: tab.id };
  }
}

async function removeIndicator(stored: StoredAgentTab): Promise<void> {
  if (stored.indicatorGroupId === undefined) return;
  const tab = await chrome.tabs.get(stored.tabId).catch(() => undefined);
  if (!tab || tab.groupId !== stored.indicatorGroupId) return;
  try {
    if (stored.originalGroupId !== undefined) await chrome.tabs.group({ tabIds: stored.tabId, groupId: stored.originalGroupId });
    else await chrome.tabs.ungroup(stored.tabId);
  } catch {
    await chrome.tabs.ungroup(stored.tabId).catch(() => undefined);
  }
}

export async function getAgentSessionForTab(tabId: number): Promise<string | undefined> {
  const tabs = await readStoredAgentTabs();
  return Object.entries(tabs).find(([, stored]) => stored.tabId === tabId)?.[0];
}

export type AgentTabClaim = { tab: chrome.tabs.Tab; displacedSessionIds: string[] };

export async function claimAgentTab(sessionId: string, tab: chrome.tabs.Tab): Promise<AgentTabClaim> {
  if (tab.id === undefined) throw new Error("The browser returned a tab without an ID.");
  const tabs = await readStoredAgentTabs();
  const old = tabs[sessionId];
  if (old?.tabId === tab.id) return { tab, displacedSessionIds: [] };
  const displaced = Object.entries(tabs).filter(([id, stored]) => id !== sessionId && stored.tabId === tab.id);
  // Clear the old group marker before using a fresh Agent group.  A displaced
  // chat loses only tab ownership.  Its history is owned by the side panel.
  if (old) await removeIndicator(old);
  for (const [, stored] of displaced) await removeIndicator(stored);
  for (const [id] of displaced) delete tabs[id];
  tabs[sessionId] = await addIndicator(tab);
  await writeStoredAgentTabs(tabs);
  await Promise.all([...displaced.map(([id]) => broadcastAgentTabState(id)), broadcastAgentTabState(sessionId)]);
  return { tab, displacedSessionIds: displaced.map(([id]) => id) };
}

/** Pins a new agent session to the tab active when its first message is sent. */
export async function ensureAgentTab(sessionId: string): Promise<chrome.tabs.Tab> {
  const tabs = await readStoredAgentTabs();
  const stored = tabs[sessionId];
  if (stored) {
    const tab = await chrome.tabs.get(stored.tabId).catch(() => undefined);
    if (tab) return tab;
    delete tabs[sessionId];
    await writeStoredAgentTabs(tabs);
  }
  const tab = await activeTab();
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  return (await claimAgentTab(sessionId, tab)).tab;
}

/** Moves agent ownership only after an explicit side-panel action. */
export async function switchAgentTab(sessionId: string, id: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(id).catch(() => undefined);
  if (!tab) throw new Error(`No browser tab exists with ID ${id}.`);
  return (await claimAgentTab(sessionId, tab)).tab;
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
    return chrome.tabs.update(existing.id, { active: true });
  }
  if (stored) {
    delete tabs[sessionId];
    await writeStoredAgentTabs(tabs);
  }
  const tab = await chrome.tabs.create(validHttpUrl(fallbackUrl) ? { url: fallbackUrl, active: true } : { active: true });
  return (await claimAgentTab(sessionId, tab)).tab;
}

/** Starts or replaces one task lease for this chat. Different chats may run independently. */
export async function startAgentTask(id: string, sessionId: string, tabId: number): Promise<void> {
  const tasks = await readStoredAgentTasks();
  const previous = tasks[sessionId];
  if (previous && previous.id !== id) settleTaskWaiters(previous.id, new Error("This browser task was replaced by a newer request."));
  tasks[sessionId] = { id, sessionId, tabId, status: "running", runMode: "foreground" };
  await writeStoredAgentTasks(tasks);
  await broadcastAgentTabState(sessionId);
}

export async function endAgentTask(id: string): Promise<void> {
  const tasks = await readStoredAgentTasks();
  const task = Object.values(tasks).find((candidate) => candidate.id === id);
  if (!task) return;
  settleTaskWaiters(id, new Error("The browser task ended."));
  delete tasks[task.sessionId];
  await writeStoredAgentTasks(tasks);
  await broadcastAgentTabState(task.sessionId);
}

/** Pauses foreground tasks that no longer own the visible tab. */
export async function pauseAgentTaskForTab(currentTabId: number): Promise<void> {
  const tasks = await readStoredAgentTasks();
  const paused = Object.values(tasks).filter((task) => task.status === "running" && task.runMode === "foreground" && task.tabId !== currentTabId);
  if (!paused.length) return;
  for (const task of paused) tasks[task.sessionId] = { ...task, status: "paused", pendingTabId: currentTabId };
  await writeStoredAgentTasks(tasks);
  await Promise.all(paused.map((task) => broadcastAgentTabState(task.sessionId, currentTabId)));
}

/** Resolves the fixed tab lease for a tool request, waiting while the user decides. */
export async function getAgentTaskTab(id: string): Promise<chrome.tabs.Tab> {
  while (true) {
    const tasks = await readStoredAgentTasks();
    const task = Object.values(tasks).find((candidate) => candidate.id === id);
    if (!task) throw new Error("This browser task is no longer active.");
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

export async function resumeAgentTask(sessionId?: string): Promise<void> {
  const tasks = await readStoredAgentTasks();
  const resumable = Object.values(tasks).filter((task) => task.status === "paused" && (!sessionId || task.sessionId === sessionId));
  if (!resumable.length) return;
  for (const task of resumable) {
    tasks[task.sessionId] = { ...task, status: "running", runMode: "foreground", pendingTabId: undefined };
    settleTaskWaiters(task.id);
  }
  await writeStoredAgentTasks(tasks);
  await Promise.all(resumable.map((task) => broadcastAgentTabState(task.sessionId)));
}

/** Lets paused tasks continue on their assigned tabs while the user visits other tabs. */
export async function continueAgentTaskInBackground(sessionId?: string): Promise<void> {
  const tasks = await readStoredAgentTasks();
  const resumable = Object.values(tasks).filter((task) => task.status !== "cancelled" && (!sessionId || task.sessionId === sessionId));
  if (!resumable.length) return;
  for (const task of resumable) {
    tasks[task.sessionId] = { ...task, status: "running", runMode: "background", pendingTabId: undefined };
    settleTaskWaiters(task.id);
  }
  await writeStoredAgentTasks(tasks);
  await Promise.all(resumable.map((task) => broadcastAgentTabState(task.sessionId)));
}

export async function cancelAgentTask(sessionId?: string): Promise<string | undefined> {
  const tasks = await readStoredAgentTasks();
  const task = sessionId ? tasks[sessionId] : Object.values(tasks).find((candidate) => candidate.status !== "cancelled");
  if (!task || task.status === "cancelled") return undefined;
  tasks[task.sessionId] = { ...task, status: "cancelled" };
  await writeStoredAgentTasks(tasks);
  settleTaskWaiters(task.id, new Error("This browser task was stopped when the agent tab changed."));
  await broadcastAgentTabState(task.sessionId);
  return task.id;
}

/** Retargets an active chat only after the user explicitly moves it. */
export async function moveAgentTaskToTab(sessionId: string, tabId: number): Promise<void> {
  await switchAgentTab(sessionId, tabId);
  const tasks = await readStoredAgentTasks();
  const task = tasks[sessionId];
  if (!task || task.status === "cancelled") return;
  tasks[sessionId] = { ...task, tabId, status: "running", runMode: "foreground", pendingTabId: undefined };
  await writeStoredAgentTasks(tasks);
  settleTaskWaiters(task.id);
  await broadcastAgentTabState(sessionId);
}

export async function getAgentTabState(sessionId: string, currentTabOverride?: chrome.tabs.Tab): Promise<AgentTabState> {
  const [tabs, tasks, currentTab] = await Promise.all([
    readStoredAgentTabs(), readStoredAgentTasks(), currentTabOverride === undefined ? activeTab() : Promise.resolve(currentTabOverride),
  ]);
  const stored = tabs[sessionId];
  const agentTab = stored ? await chrome.tabs.get(stored.tabId).catch(() => undefined) : undefined;
  const currentTabSessionId = currentTab?.id === undefined
    ? undefined
    : Object.entries(tabs).find(([, assignment]) => assignment.tabId === currentTab.id)?.[0];
  const task = tasks[sessionId];
  return {
    ...(stored ? { agentTabId: stored.tabId } : {}),
    ...(agentTab ? { agentTab: summarizeTab(agentTab) } : {}),
    ...(currentTab ? { currentTab: summarizeTab(currentTab) } : {}),
    ...(currentTabSessionId ? { currentTabSessionId } : {}),
    ...(task ? { task: { status: task.status, tabId: task.tabId, runMode: task.runMode, ...(task.pendingTabId !== undefined ? { pendingTabId: task.pendingTabId } : {}) } } : {}),
    activeTaskCount: Object.values(tasks).filter((candidate) => candidate.status === "running").length,
  };
}

export async function broadcastAgentTabState(sessionId?: string, currentTabId?: number): Promise<void> {
  const currentTab = currentTabId === undefined ? undefined : await chrome.tabs.get(currentTabId).catch(() => undefined);
  if (sessionId) {
    const state = await getAgentTabState(sessionId, currentTab);
    await chrome.runtime.sendMessage({ type: "dsh-agent-tab-state", sessionId, state }).catch(() => undefined);
    return;
  }

  // A task can end while another chat is displayed.  Broadcast every known
  // session so each panel can refresh its global running-task count.
  const [tabs, tasks] = await Promise.all([readStoredAgentTabs(), readStoredAgentTasks()]);
  const sessionIds = new Set([...Object.keys(tabs), ...Object.keys(tasks)]);
  await Promise.all([...sessionIds].map(async (id) => {
    const state = await getAgentTabState(id, currentTab);
    await chrome.runtime.sendMessage({ type: "dsh-agent-tab-state", sessionId: id, state }).catch(() => undefined);
  }));
}

function summarizeTab(tab: chrome.tabs.Tab): Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId"> {
  return { id: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId };
}

function validHttpUrl(value?: string): value is string {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; }
  catch { return false; }
}

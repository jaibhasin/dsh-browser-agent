const STORAGE_KEY = "dshAgentTab";
const INDICATOR_TITLE = "Agent";

type StoredAgentTab = {
  tabId: number;
  indicatorGroupId?: number;
  originalGroupId?: number;
};

export type AgentTabState = {
  agentTabId?: number;
  agentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
  currentTab?: Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId">;
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

export async function getAgentTabState(): Promise<AgentTabState> {
  const [stored, currentTab] = await Promise.all([readStoredAgentTab(), activeTab()]);
  const agentTab = stored ? await chrome.tabs.get(stored.tabId).catch(() => undefined) : undefined;
  return {
    ...(stored ? { agentTabId: stored.tabId } : {}),
    ...(agentTab ? { agentTab: summarizeTab(agentTab) } : {}),
    ...(currentTab ? { currentTab: summarizeTab(currentTab) } : {}),
  };
}

export async function broadcastAgentTabState(): Promise<void> {
  const state = await getAgentTabState();
  await chrome.runtime.sendMessage({ type: "dsh-agent-tab-state", state }).catch(() => undefined);
}

function summarizeTab(tab: chrome.tabs.Tab): Pick<chrome.tabs.Tab, "id" | "title" | "url" | "windowId"> {
  return { id: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId };
}

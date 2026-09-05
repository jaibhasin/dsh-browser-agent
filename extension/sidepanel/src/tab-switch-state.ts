export type TabSummary = { id?: number; title?: string; url?: string; windowId?: number };

export type AgentTaskState = {
  status: "running" | "paused" | "cancelled";
  tabId: number;
  runMode: "foreground" | "background";
  pendingTabId?: number;
};

export type AgentTabState = {
  agentTabId?: number;
  agentTab?: TabSummary;
  currentTab?: TabSummary;
  currentTabSessionId?: string;
  task?: AgentTaskState;
  activeTaskCount: number;
};

export type TabSwitchView =
  | { kind: "active-task"; tab: TabSummary }
  | { kind: "saved-chat"; tab: TabSummary; sessionId: string }
  | { kind: "new-tab"; tab: TabSummary }
  | { kind: "none" };

type TabSwitchInput = {
  state: AgentTabState;
  activeSessionId: string;
  savedSessionIds: ReadonlySet<string>;
  historyReady: boolean;
  dismissedTabId?: number;
};

/**
 * Chooses the next tab-switch interaction from browser ownership and task state.
 * Active foreground work must be resolved first. Once it is safe to change
 * chats, a tab's saved chat takes precedence over offering a fresh chat.
 */
export function getTabSwitchView({
  state,
  activeSessionId,
  savedSessionIds,
  historyReady,
  dismissedTabId,
}: TabSwitchInput): TabSwitchView {
  const tab = state.currentTab;
  if (tab?.id === undefined || dismissedTabId === tab.id) return { kind: "none" };

  const isDifferentAgentTab = state.agentTabId !== undefined && state.agentTabId !== tab.id;
  const foregroundTaskNeedsDecision = isDifferentAgentTab &&
    state.task !== undefined &&
    state.task.status !== "cancelled" &&
    state.task.runMode === "foreground";
  if (foregroundTaskNeedsDecision) return { kind: "active-task", tab };

  const destinationSessionId = state.currentTabSessionId;
  if (destinationSessionId && destinationSessionId !== activeSessionId) {
    if (!historyReady) return { kind: "none" };
    if (savedSessionIds.has(destinationSessionId)) {
      return { kind: "saved-chat", tab, sessionId: destinationSessionId };
    }
    return { kind: "new-tab", tab };
  }

  if (isDifferentAgentTab) return { kind: "new-tab", tab };
  return { kind: "none" };
}

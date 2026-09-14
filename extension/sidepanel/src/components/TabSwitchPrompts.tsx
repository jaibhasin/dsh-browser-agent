import { type SavedChat } from "../chat-history";
import { type AgentTabState, type TabSwitchView } from "../tab-switch-state";

import type * as React from "react";
import { tabLabel } from "../labels";
import type { CurrentTaskAction } from "../requests";

type TabSwitchPromptsProps = {
  tabSwitchView: TabSwitchView;
  agentTabState: AgentTabState;
  resolveCurrentTask: (action: CurrentTaskAction) => Promise<void>;
  isSwitchingTab: boolean;
  moveAgentToCurrentTab: () => Promise<void>;
  keepCurrentChat: () => void;
  startNewOnDestination: () => Promise<void>;
  pendingSavedChat: SavedChat | undefined;
  setPendingSavedChat: React.Dispatch<React.SetStateAction<SavedChat | undefined>>;
  continueAndOpenSavedChat: () => Promise<void>;
  pauseAndOpenSavedChat: () => Promise<void>;
  quitAndOpenSavedChat: () => Promise<void>;
};

export function TabSwitchPrompts({
  tabSwitchView,
  agentTabState,
  resolveCurrentTask,
  isSwitchingTab,
  moveAgentToCurrentTab,
  keepCurrentChat,
  startNewOnDestination,
  pendingSavedChat,
  setPendingSavedChat,
  continueAndOpenSavedChat,
  pauseAndOpenSavedChat,
  quitAndOpenSavedChat,
}: TabSwitchPromptsProps) {
  return (
    <>
      {tabSwitchView.kind === "active-task" && (
        <section className="tab-switch-prompt" role="dialog" aria-label="Switch agent tab" aria-live="assertive">
          <div>
            <strong>Switch to {tabLabel(tabSwitchView.tab)}?</strong>
            <p>{agentTabState.task?.status === "paused" && agentTabState.agentTab
              ? `Work on ${tabLabel(agentTabState.agentTab)} is paused until you choose.`
              : agentTabState.agentTab ? `The agent is assigned to ${tabLabel(agentTabState.agentTab)}.` : "The assigned tab was closed."}</p>
          </div>
          <div className="tab-switch-actions">
            <button type="button" onClick={() => void resolveCurrentTask("background")} disabled={isSwitchingTab}>Continue in background</button>
            <button type="button" onClick={() => void resolveCurrentTask("pause")} disabled={isSwitchingTab}>Pause current chat</button>
            <button type="button" onClick={() => void resolveCurrentTask("quit")} disabled={isSwitchingTab}>Quit current chat</button>
            <button className="tab-switch-primary" type="button" onClick={() => void moveAgentToCurrentTab()} disabled={isSwitchingTab}>
              {isSwitchingTab ? "Switching..." : "Move chat here"}
            </button>
          </div>
        </section>
      )}

      {tabSwitchView.kind === "new-tab" && (
        <section className="tab-switch-prompt" role="dialog" aria-label="Start chat on this tab" aria-live="assertive">
          <div>
            <strong>Start a chat on {tabLabel(tabSwitchView.tab)}?</strong>
            <p>{agentTabState.agentTab
              ? `Your current chat stays saved on ${tabLabel(agentTabState.agentTab)}.`
              : "Start a separate chat for this tab."}</p>
          </div>
          <div className="tab-switch-actions">
            <button type="button" onClick={keepCurrentChat} disabled={isSwitchingTab}>Keep current chat</button>
            {agentTabState.agentTabId !== undefined && (
              <button type="button" onClick={() => void moveAgentToCurrentTab()} disabled={isSwitchingTab}>Move current chat here</button>
            )}
            <button className="tab-switch-primary" type="button" onClick={() => void startNewOnDestination()} disabled={isSwitchingTab}>
              {isSwitchingTab ? "Starting..." : "Start new chat"}
            </button>
          </div>
        </section>
      )}

      {pendingSavedChat && (
        <section className="tab-switch-prompt" role="dialog" aria-label="Open saved chat" aria-live="assertive">
          <div>
            <strong>Open {pendingSavedChat.title}?</strong>
            <p>Your current task is still active. Choose what should happen before switching chats.</p>
          </div>
          <div className="tab-switch-actions">
            <button type="button" onClick={() => setPendingSavedChat(undefined)} disabled={isSwitchingTab}>Keep current chat</button>
            <button type="button" onClick={() => void continueAndOpenSavedChat()} disabled={isSwitchingTab}>Continue in background</button>
            <button type="button" onClick={() => void pauseAndOpenSavedChat()} disabled={isSwitchingTab}>Pause and open</button>
            <button className="tab-switch-primary" type="button" onClick={() => void quitAndOpenSavedChat()} disabled={isSwitchingTab}>Quit and open</button>
          </div>
        </section>
      )}
    </>
  );
}

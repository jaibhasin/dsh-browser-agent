import { type AgentTabState } from "../tab-switch-state";

import type * as React from "react";
import { connectionLabel } from "../labels";

type PanelHeaderProps = {
  connectionStatus: string;
  agentTabState: AgentTabState;
  attentionCount: number;
  setIsHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isHistoryOpen: boolean;
  startNewSession: () => Promise<void>;
  isStartingSession: boolean;
  saveCurrentAsTask: () => void;
};

export function PanelHeader({
  connectionStatus,
  agentTabState,
  attentionCount,
  setIsHistoryOpen,
  isHistoryOpen,
  startNewSession,
  isStartingSession,
  saveCurrentAsTask,
}: PanelHeaderProps) {
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><img src="../icons/deepseek-mark.svg" alt="" /></div>
          <span className="brand-title">dsh Browser Agent</span>
        </div>
        <div className="header-actions">
          <span
            className="status-pill"
            title={`${connectionStatus}${agentTabState.activeTaskCount > 0 ? ` · ${agentTabState.activeTaskCount} active` : ""}`}
          >
            <span className={`status-dot status-${connectionStatus}`} aria-hidden="true" />
            <span>{connectionLabel(connectionStatus)}</span>
          </span>
          {agentTabState.activeTaskCount > 0 && (
            <span
              className="task-dot"
              title={`${agentTabState.activeTaskCount} active task${agentTabState.activeTaskCount === 1 ? "" : "s"}`}
              aria-hidden="true"
            />
          )}
          {attentionCount > 0 && (
            <span className="attention-count" title={`${attentionCount} session${attentionCount === 1 ? "" : "s"} needs input`}>
              {attentionCount}
            </span>
          )}
          <button className="icon-button" type="button" onClick={saveCurrentAsTask} aria-label="Save as a task" title="Save this conversation as a task" disabled={agentTabState.activeTaskCount > 0}>
            <span aria-hidden="true">☆</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setIsHistoryOpen((open) => !open)}
            aria-expanded={isHistoryOpen}
            aria-label="Chat history"
            title="Chat history"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 2a1 1 0 0 0-1 1v9.5a.5.5 0 0 0 .5.5H4v1.5a.5.5 0 0 0 .82.384l2.392-1.992h5.288a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H3Zm0 1h10v8.392H6.908l-1.91 1.592V11.392H3V3Z" />
            </svg>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => void startNewSession()}
            disabled={isStartingSession}
            aria-label="New chat"
            title={isStartingSession ? "Starting..." : "Delete this chat and start a new one"}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 1.25a.75.75 0 0 1 .75.75v5.25H14a.75.75 0 0 1 0 1.5H8.75V14a.75.75 0 0 1-1.5 0V8.75H2a.75.75 0 0 1 0-1.5h5.25V2A.75.75 0 0 1 8 1.25Z" />
            </svg>
          </button>
        </div>
      </header>
    </>
  );
}

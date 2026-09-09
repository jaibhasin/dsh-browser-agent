import { AGENT_TOOL_DEFS, type AgentToolName, type StoredTools } from "../tools";

import type * as React from "react";

type ToolPermissionsProps = {
  toolsMenuOpen: boolean;
  setToolsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  effectiveDeniedTools: ("browser_click" | "browser_navigate" | "browser_type" | "ask_user" | "browser_tabs" | "browser_snapshot" | "browser_wait" | "browser_screenshot" | "browser_scroll")[];
  activeToolIndex: number;
  setActiveToolIndex: React.Dispatch<React.SetStateAction<number>>;
  toggleToolForChat: (tool: AgentToolName) => void;
  resetChatTools: () => void;
  toolSettings: StoredTools;
  activeSessionId: string;
  setEffectiveAsDefault: () => void;
};

export function ToolPermissions({
  toolsMenuOpen,
  setToolsMenuOpen,
  effectiveDeniedTools,
  activeToolIndex,
  setActiveToolIndex,
  toggleToolForChat,
  resetChatTools,
  toolSettings,
  activeSessionId,
  setEffectiveAsDefault,
}: ToolPermissionsProps) {
  return (
    <>
      {toolsMenuOpen && (
        <section className="tools-menu" aria-label="Tool permissions" aria-describedby="tools-menu-help">
          <div className="tools-menu-header">
            <div>
              <span className="tools-menu-eyebrow">Agent controls</span>
              <strong>Tool permissions</strong>
            </div>
            <span id="tools-menu-help" className="tools-menu-help">Choose what this chat can use.</span>
            <button type="button" className="tools-menu-close" onClick={() => setToolsMenuOpen(false)} aria-label="Close tool permissions">✕</button>
          </div>
          <div className="tools-menu-summary">
            <span><strong>{AGENT_TOOL_DEFS.length - effectiveDeniedTools.length}</strong> of {AGENT_TOOL_DEFS.length} tools enabled</span>
          </div>
          <ul className="tools-list" role="listbox" aria-label="Agent tools">
            {AGENT_TOOL_DEFS.map((tool, index) => {
              const enabled = !effectiveDeniedTools.includes(tool.name);
              return (
                <li key={tool.name} className={index === activeToolIndex ? "tool-row-active" : undefined} role="option" aria-selected={index === activeToolIndex} onMouseEnter={() => setActiveToolIndex(index)}>
                  <label className="tool-toggle">
                    <input type="checkbox" checked={enabled} onChange={() => toggleToolForChat(tool.name)} />
                    <span className="tool-toggle-track" aria-hidden="true"><span className="tool-toggle-thumb" /></span>
                    <span className="tool-toggle-text">
                      <span className="tool-toggle-name">{tool.label}</span>
                      <span className="tool-toggle-desc">{tool.description}</span>
                    </span>
                    <span className={`tool-toggle-status${enabled ? " tool-toggle-status-on" : ""}`}>{enabled ? "On" : "Off"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="tools-menu-actions">
            <button type="button" onClick={resetChatTools} disabled={!toolSettings.deniedByChat[activeSessionId]}>Reset to defaults</button>
            <button type="button" onClick={setEffectiveAsDefault}>Use as my default</button>
          </div>
        </section>
      )}
    </>
  );
}

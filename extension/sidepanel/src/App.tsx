import type { ThemePreference } from "./theme";
import { useSidepanelController } from "./hooks/useSidepanelController";
import { tabLabel } from "./labels";
import { PanelHeader } from "./components/PanelHeader";
import { ChatHistory } from "./components/ChatHistory";
import { Conversation } from "./components/Conversation";
import { TabSwitchPrompts } from "./components/TabSwitchPrompts";
import { ChatDialogs } from "./components/ChatDialogs";
import { ToolPermissions } from "./components/ToolPermissions";
import { Composer } from "./components/Composer";
import { TaskDialogs } from "./components/TaskDialogs";

function App({ initialThemePreference = "system" }: { initialThemePreference?: ThemePreference }) {
  const panel = useSidepanelController(initialThemePreference);
  const { agentTabState } = panel;

  return (
    <main className="app-shell">
      <PanelHeader {...panel.panelHeader} />

      <ChatHistory {...panel.chatHistory} />

      {agentTabState.agentTabId !== undefined && (
        <section className="agent-tab-status" aria-label="Agent tab">
          <span className="agent-tab-dot" aria-hidden="true" />
          <span><strong>Agent tab</strong>{agentTabState.agentTab ? tabLabel(agentTabState.agentTab) : "Closed"}</span>
        </section>
      )}

      <Conversation {...panel.conversation} />

      <TabSwitchPrompts {...panel.tabSwitchPrompts} />

      <ChatDialogs {...panel.chatDialogs} />
      <TaskDialogs {...panel.taskDialogs} />

      <ToolPermissions {...panel.toolPermissions} />

      <Composer {...panel.composer} />

    </main>
  );
}

export default App;

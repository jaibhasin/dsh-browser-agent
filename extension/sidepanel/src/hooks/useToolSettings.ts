import { useEffect, useState } from "react";
import type { SavedChat } from "../chat-history";
import { effectiveDenied, loadToolSettings, saveToolSettings, type AgentToolName, type StoredTools } from "../tools";

export function useToolSettings(activeSessionId: string, historyReady: boolean, savedChats: SavedChat[]) {
  const [toolSettings, setToolSettings] = useState<StoredTools>({ version: 3, deniedDefault: [], deniedByChat: {} });
  const [toolSettingsReady, setToolSettingsReady] = useState(false);

  useEffect(() => {
    void loadToolSettings().then((settings) => {
      setToolSettings(settings);
      setToolSettingsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!historyReady || !toolSettingsReady) return;
    const sessionIds = [activeSessionId, ...savedChats.map((chat) => chat.id)];
    const missingSessionIds = sessionIds.filter((sessionId) => toolSettings.deniedByChat[sessionId] === undefined);
    if (missingSessionIds.length === 0) return;
    const deniedByChat = { ...toolSettings.deniedByChat };
    for (const sessionId of missingSessionIds) deniedByChat[sessionId] = [...toolSettings.deniedDefault];
    updateToolSettings({ version: 3, deniedDefault: toolSettings.deniedDefault, deniedByChat });
  }, [activeSessionId, historyReady, toolSettingsReady]);

  function updateToolSettings(next: StoredTools) {
    setToolSettings(next);
    void saveToolSettings(next);
  }

  function toggleToolForChat(tool: AgentToolName) {
    const denied = new Set(effectiveDenied(toolSettings, activeSessionId));
    if (denied.has(tool)) denied.delete(tool);
    else denied.add(tool);
    updateToolSettings({
      version: 3,
      deniedDefault: toolSettings.deniedDefault,
      deniedByChat: { ...toolSettings.deniedByChat, [activeSessionId]: [...denied].sort() },
    });
  }

  function resetChatTools() {
    const deniedByChat = { ...toolSettings.deniedByChat };
    delete deniedByChat[activeSessionId];
    updateToolSettings({ version: 3, deniedDefault: toolSettings.deniedDefault, deniedByChat });
  }

  function setEffectiveAsDefault() {
    updateToolSettings({
      version: 3,
      deniedDefault: effectiveDenied(toolSettings, activeSessionId),
      deniedByChat: toolSettings.deniedByChat,
    });
  }

  const effectiveDeniedTools = effectiveDenied(toolSettings, activeSessionId);
  return { toolSettings, updateToolSettings, toggleToolForChat, resetChatTools, setEffectiveAsDefault, effectiveDeniedTools };
}

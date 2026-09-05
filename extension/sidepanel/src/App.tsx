import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MarkdownMessage } from "./MarkdownMessage";
import { chatTitle, collectHttpLinks, loadChatHistory, removeChat, saveChat, type ActivityGroup, type ChatMessage as Message, type ConversationItem, type SavedChat, type ToolActivity } from "./chat-history";
import type { BridgeChatProgress } from "../../../shared/protocol";

type TabSummary = { id?: number; title?: string; url?: string; windowId?: number };
type AgentTaskState = { status: "running" | "paused" | "cancelled"; tabId: number; runMode: "foreground" | "background"; pendingTabId?: number };
type AgentTabState = { agentTabId?: number; agentTab?: TabSummary; currentTab?: TabSummary; currentTabSessionId?: string; task?: AgentTaskState; activeTaskCount: number };
type DestinationAction = "pause" | "quit";

function App() {
  const [messages, setMessages] = useState<ConversationItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(() => newSessionId());
  const [sessionCreatedAt, setSessionCreatedAt] = useState(() => Date.now());
  const [sessionLinks, setSessionLinks] = useState<string[]>([]);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [pendingSavedChat, setPendingSavedChat] = useState<SavedChat>();
  const [pendingDestinationAction, setPendingDestinationAction] = useState<DestinationAction>();
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [sessionNotice, setSessionNotice] = useState("");
  const [agentTabState, setAgentTabState] = useState<AgentTabState>({ activeTaskCount: 0 });
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [dismissedTabId, setDismissedTabId] = useState<number>();
  const activeChatIds = useRef(new Set<string>());
  const activeChatSessions = useRef(new Map<string, string>());
  const activeSessionIdRef = useRef(activeSessionId);
  const historyRef = useRef<SavedChat[]>([]);
  const sessionItemsRef = useRef(new Map<string, ConversationItem[]>());
  const sessionLinksRef = useRef(new Map<string, string[]>());
  const sessionCreatedAtRef = useRef(new Map<string, number>());
  const sessionStatusRef = useRef(new Map<string, SavedChat["status"]>());
  const deletedSessionIds = useRef(new Set<string>());
  const currentTabId = useRef<number | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  activeSessionIdRef.current = activeSessionId;

  function syncSavedChats(next: SavedChat[]) {
    const sorted = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    historyRef.current = sorted;
    setSavedChats(sorted);
  }

  function persistSession(sessionId: string, status?: SavedChat["status"]) {
    if (deletedSessionIds.current.has(sessionId)) return;
    const items = sessionItemsRef.current.get(sessionId) ?? [];
    if (items.length === 0) return;
    const existing = historyRef.current.find((chat) => chat.id === sessionId);
    const nextStatus = status ?? sessionStatusRef.current.get(sessionId) ?? existing?.status ?? "completed";
    sessionStatusRef.current.set(sessionId, nextStatus);
    const record: SavedChat = {
      id: sessionId,
      title: chatTitle(items),
      createdAt: sessionCreatedAtRef.current.get(sessionId) ?? existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      status: nextStatus,
      items,
      links: sessionLinksRef.current.get(sessionId) ?? existing?.links ?? [],
    };
    sessionCreatedAtRef.current.set(sessionId, record.createdAt);
    syncSavedChats([record, ...historyRef.current.filter((chat) => chat.id !== sessionId)]);
    void saveChat(record).catch(() => {
      setSessionNotice("This chat could not be saved locally.");
    });
  }

  function updateConversation(sessionId: string, updater: (items: ConversationItem[]) => ConversationItem[], status?: SavedChat["status"]) {
    if (deletedSessionIds.current.has(sessionId)) return;
    const next = updater(sessionItemsRef.current.get(sessionId) ?? []);
    sessionItemsRef.current.set(sessionId, next);
    if (activeSessionIdRef.current === sessionId) setMessages(next);
    persistSession(sessionId, status);
  }

  function setSessionStatus(sessionId: string, status: SavedChat["status"]) {
    sessionStatusRef.current.set(sessionId, status);
    persistSession(sessionId, status);
  }

  function forgetSession(sessionId: string) {
    deletedSessionIds.current.add(sessionId);
    sessionItemsRef.current.delete(sessionId);
    sessionLinksRef.current.delete(sessionId);
    sessionCreatedAtRef.current.delete(sessionId);
    sessionStatusRef.current.delete(sessionId);
    syncSavedChats(historyRef.current.filter((chat) => chat.id !== sessionId));
    return removeChat(sessionId);
  }

  function applyAgentTabState(state: AgentTabState) {
    if (state.currentTab?.id !== currentTabId.current) setDismissedTabId(undefined);
    currentTabId.current = state.currentTab?.id;
    setAgentTabState(state);
  }

  async function refreshAgentTabState(sessionId = activeSessionIdRef.current) {
    const response = await chrome.runtime.sendMessage({ type: "dsh-agent-tab-state-request", sessionId }) as { ok?: boolean; state?: AgentTabState };
    if (response?.ok && response.state) applyAgentTabState(response.state);
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [prompt]);

  useEffect(() => {
    messagesRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    void loadChatHistory().then((history) => {
      const byId = new Map(historyRef.current.map((chat) => [chat.id, chat]));
      for (const chat of history) {
        const current = byId.get(chat.id);
        if (!current || chat.updatedAt >= current.updatedAt) byId.set(chat.id, chat);
      }
      const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const chat of merged) {
        sessionItemsRef.current.set(chat.id, chat.items);
        sessionLinksRef.current.set(chat.id, chat.links);
        sessionCreatedAtRef.current.set(chat.id, chat.createdAt);
        sessionStatusRef.current.set(chat.id, chat.status);
      }
      historyRef.current = merged;
      setSavedChats(merged);
      setHistoryReady(true);
    });
  }, []);

  useEffect(() => {
    setSessionLinks((links) => collectHttpLinks(links, agentTabState.agentTab?.url));
  }, [agentTabState.agentTab?.url]);

  useEffect(() => {
    if (!historyReady || deletedSessionIds.current.has(activeSessionId)) return;
    sessionItemsRef.current.set(activeSessionId, messages);
    sessionLinksRef.current.set(activeSessionId, sessionLinks);
    sessionCreatedAtRef.current.set(activeSessionId, sessionCreatedAt);
    // The background task in AgentTabState can belong to a different chat.
    // Only this panel's own in-flight request may mark this saved chat active.
    const status = isLoading ? "active" : sessionStatusRef.current.get(activeSessionId) ?? "completed";
    persistSession(activeSessionId, status);
  }, [activeSessionId, agentTabState.task?.status, historyReady, isLoading, messages, sessionCreatedAt, sessionLinks]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "dsh-bridge-status" }, (response) => {
      if (!chrome.runtime.lastError) setConnectionStatus(response?.status === "connected" ? "connected" : response?.status ?? "disconnected");
    });
    void refreshAgentTabState();
    const onMessage = (message: { type?: string; status?: string; progress?: BridgeChatProgress; state?: AgentTabState; sessionId?: string }) => {
      if (message.type === "dsh-bridge-status" && message.status) {
        setConnectionStatus(message.status);
      } else if (message.type === "dsh-agent-chat-displaced" && message.sessionId) {
        void forgetSession(message.sessionId);
      } else if (message.type === "dsh-chat-progress" && message.progress && activeChatIds.current.has(message.progress.id)) {
        const sessionId = activeChatSessions.current.get(message.progress.id);
        if (sessionId) addToolProgress(sessionId, message.progress);
      } else if (message.type === "dsh-agent-tab-state" && message.state && message.sessionId === activeSessionIdRef.current) {
        applyAgentTabState(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshAgentTabState();
    };
    const refreshOnBrowserChange = () => void refreshAgentTabState();
    chrome.tabs.onActivated.addListener(refreshOnBrowserChange);
    chrome.windows.onFocusChanged.addListener(refreshOnBrowserChange);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(refreshOnBrowserChange);
      chrome.windows.onFocusChanged.removeListener(refreshOnBrowserChange);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const suggestedTab = agentTabState.agentTabId !== undefined &&
    agentTabState.currentTab?.id !== undefined &&
    agentTabState.agentTabId !== agentTabState.currentTab.id &&
    agentTabState.task?.runMode !== "background" &&
    dismissedTabId !== agentTabState.currentTab.id
    ? agentTabState.currentTab
    : undefined;

  function addToolProgress(sessionId: string, progress: BridgeChatProgress) {
    updateConversation(sessionId, (currentMessages) => {
      const groupIndex = currentMessages.findIndex((item) => item.kind === "activity" && item.id === progress.id);
      const step: ToolActivity = {
        callId: progress.callId,
        tool: progress.tool,
        ...(progress.detail ? { input: progress.detail } : {}),
        ...(progress.output ? { output: progress.output } : {}),
        status: progress.phase === "tool_started" ? "running" : progress.phase === "tool_finished" ? "success" : "error",
        ...(progress.error ? { error: progress.error } : {}),
      };
      if (groupIndex === -1) return [...currentMessages, { kind: "activity", id: progress.id, steps: [step] }];

      const group = currentMessages[groupIndex] as ActivityGroup;
      const existingIndex = group.steps.findIndex((candidate) => candidate.callId === progress.callId);
      const steps = existingIndex === -1
        ? [...group.steps, step]
        : group.steps.map((candidate, index) => index === existingIndex
          ? { ...candidate, ...step, input: step.input ?? candidate.input, output: step.output ?? candidate.output }
          : candidate);
      return currentMessages.map((item, index) => index === groupIndex ? { ...group, steps } : item);
    }, "active");
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isLoading) return;

    if (connectionStatus !== "connected") {
      setSessionNotice("Start DSH to send this message. Your new chat is ready when it reconnects.");
      return;
    }

    const id = crypto.randomUUID();
    const sessionId = activeSessionId;
    const resume = messages.length > 0;
    setIsLoading(true);
    let userMessageAdded = false;
    try {
      activeChatIds.current.add(id);
      activeChatSessions.current.set(id, sessionId);
      updateConversation(sessionId, (currentMessages) => [...currentMessages, { kind: "message", id: crypto.randomUUID(), role: "user", text }], "active");
      userMessageAdded = true;
      setPrompt("");
      setSessionNotice("");
      const response = await chrome.runtime.sendMessage({ type: "dsh-chat", id, text, sessionId, resume }) as { ok?: boolean; text?: string; error?: string; displacedSessionIds?: string[] };
      await forgetDisplacedSessions(response?.displacedSessionIds, sessionId);
      updateConversation(sessionId, (currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: response?.ok && response.text ? response.text : `I couldn't complete that request: ${response?.error ?? "The DSH bridge is unavailable."}`,
      }], sessionStatusRef.current.get(sessionId) === "paused" ? "paused" : response?.ok ? "completed" : "interrupted");
    } catch (error) {
      updateConversation(sessionId, (currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: error instanceof Error ? error.message : "The snapshot bridge is unavailable.",
      }], sessionStatusRef.current.get(sessionId) === "paused" ? "paused" : "interrupted");
    } finally {
      activeChatIds.current.delete(id);
      activeChatSessions.current.delete(id);
      if (activeSessionIdRef.current === sessionId) setIsLoading(false);
    }
  }

  async function startNewSession() {
    if (isLoading || isStartingSession) return;
    const createdAt = Date.now();
    const sessionId = newSessionId();
    deletedSessionIds.current.delete(sessionId);
    sessionCreatedAtRef.current.set(sessionId, createdAt);
    sessionItemsRef.current.set(sessionId, []);
    sessionLinksRef.current.set(sessionId, []);
    setActiveSessionId(sessionId);
    setSessionCreatedAt(createdAt);
    setMessages([]);
    setSessionLinks([]);
    setAgentTabState({ activeTaskCount: 0 });
    currentTabId.current = undefined;
    setPrompt("");
    setSessionNotice(connectionStatus === "connected" ? "New chat ready." : "New chat is ready. It will start when DSH reconnects.");
    textareaRef.current?.focus();
    void refreshAgentTabState(sessionId);
  }

  async function startFreshChatOnCurrentTab() {
    const sessionId = newSessionId();
    const createdAt = Date.now();
    deletedSessionIds.current.delete(sessionId);
    sessionCreatedAtRef.current.set(sessionId, createdAt);
    sessionItemsRef.current.set(sessionId, []);
    sessionLinksRef.current.set(sessionId, []);
    setActiveSessionId(sessionId);
    setSessionCreatedAt(createdAt);
    setMessages([]);
    setSessionLinks([]);
    setPrompt("");
    setIsLoading(false);
    setAgentTabState({ activeTaskCount: 0 });
    currentTabId.current = undefined;
    setSessionNotice("New chat ready on this tab.");
    const response = await chrome.runtime.sendMessage({ type: "dsh-agent-claim-tab", sessionId }) as { ok?: boolean; error?: string; displacedSessionIds?: string[] };
    if (!response?.ok) setSessionNotice(response?.error ?? "The new chat could not claim this tab.");
    else await forgetDisplacedSessions(response.displacedSessionIds, sessionId);
    await refreshAgentTabState(sessionId);
    textareaRef.current?.focus();
  }

  async function forgetDisplacedSessions(sessionIds: string[] | undefined, claimingSessionId: string) {
    for (const sessionId of sessionIds ?? []) {
      if (sessionId !== claimingSessionId) await forgetSession(sessionId);
    }
  }

  function destinationSavedChat(): SavedChat | undefined {
    const sessionId = agentTabState.currentTabSessionId;
    return sessionId && sessionId !== activeSessionId
      ? historyRef.current.find((chat) => chat.id === sessionId)
      : undefined;
  }

  function offerDestinationChatChoice(action: DestinationAction): boolean {
    if (!destinationSavedChat()) return false;
    setPendingDestinationAction(action);
    return true;
  }

  async function pauseChatAndStartNew(skipDestinationChoice = false) {
    if (!skipDestinationChoice && offerDestinationChatChoice("pause")) return;
    const sessionId = activeSessionId;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-pause-chat", sessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The chat could not be paused.");
      setSessionStatus(sessionId, "paused");
      await startFreshChatOnCurrentTab();
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The chat could not be paused.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function discardChatAndStartNew(skipDestinationChoice = false) {
    if (!skipDestinationChoice && offerDestinationChatChoice("quit")) return;
    const sessionId = activeSessionId;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-discard-chat", sessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The chat could not be discarded.");
      await forgetSession(sessionId);
      await startFreshChatOnCurrentTab();
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The chat could not be discarded.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function resolveDestinationChoice(openPrevious: boolean) {
    const action = pendingDestinationAction;
    const destination = destinationSavedChat();
    if (!action || !destination) {
      setPendingDestinationAction(undefined);
      return;
    }
    if (!openPrevious) {
      setPendingDestinationAction(undefined);
      if (action === "pause") await pauseChatAndStartNew(true);
      else await discardChatAndStartNew(true);
      return;
    }

    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: action === "pause" ? "dsh-agent-pause-chat" : "dsh-agent-discard-chat",
        sessionId: activeSessionId,
      }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The current chat could not be changed.");
      if (action === "pause") setSessionStatus(activeSessionId, "paused");
      else await forgetSession(activeSessionId);
      setPendingDestinationAction(undefined);
      setIsLoading(false);
      activateSavedChat(destination);
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The current chat could not be changed.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  function activateSavedChat(chat: SavedChat) {
    deletedSessionIds.current.delete(chat.id);
    sessionItemsRef.current.set(chat.id, chat.items);
    sessionLinksRef.current.set(chat.id, chat.links);
    sessionCreatedAtRef.current.set(chat.id, chat.createdAt);
    sessionStatusRef.current.set(chat.id, chat.status);
    setActiveSessionId(chat.id);
    setSessionCreatedAt(chat.createdAt);
    setMessages(chat.items);
    setSessionLinks(chat.links);
    setPrompt("");
    setSessionNotice(chat.status === "interrupted" ? "This chat was interrupted. The agent will inspect the page before continuing." : "Saved chat opened.");
    setIsHistoryOpen(false);
    void refreshAgentTabState(chat.id);
    void chrome.runtime.sendMessage({ type: "dsh-agent-focus-chat", sessionId: chat.id, url: chat.links[0] })
      .then((response: { ok?: boolean; error?: string }) => {
        if (!response?.ok) setSessionNotice(response?.error ?? "The saved chat tab could not be opened.");
        else void refreshAgentTabState(chat.id);
      });
  }

  function openSavedChat(chat: SavedChat) {
    if (chat.id === activeSessionId) return;
    if (isLoading || agentTabState.task?.status === "running") {
      setPendingSavedChat(chat);
      return;
    }
    activateSavedChat(chat);
  }

  async function continueAndOpenSavedChat() {
    const chat = pendingSavedChat;
    if (!chat) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-continue-background", sessionId: activeSessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The current task could not continue in the background.");
      setPendingSavedChat(undefined);
      setIsLoading(false);
      activateSavedChat(chat);
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The current task could not continue in the background.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function pauseAndOpenSavedChat() {
    const chat = pendingSavedChat;
    if (!chat) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-pause-chat", sessionId: activeSessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The current chat could not be paused.");
      setSessionStatus(activeSessionId, "paused");
      setPendingSavedChat(undefined);
      setIsLoading(false);
      activateSavedChat(chat);
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The current chat could not be paused.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function quitAndOpenSavedChat() {
    const chat = pendingSavedChat;
    if (!chat) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-discard-chat", sessionId: activeSessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The current chat could not be discarded.");
      await forgetSession(activeSessionId);
      setPendingSavedChat(undefined);
      setIsLoading(false);
      activateSavedChat(chat);
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The current chat could not be discarded.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function moveAgentToCurrentTab() {
    if (suggestedTab?.id === undefined || isSwitchingTab) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-switch-tab", id: suggestedTab.id, sessionId: activeSessionId }) as { ok?: boolean; error?: string; displacedSessionIds?: string[] };
      if (!response?.ok) throw new Error(response?.error ?? "The agent tab could not be changed.");
      // Moving a chat never deletes the chat that previously owned this tab.
      // It remains in history and can recreate its site when reopened.
      setDismissedTabId(undefined);
    } catch (error) {
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: error instanceof Error ? error.message : "The agent tab could not be changed.",
      }]);
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function keepCurrentTask() {
    if (!suggestedTab || isSwitchingTab) return;
    if (agentTabState.task?.status !== "paused") {
      setDismissedTabId(suggestedTab.id);
      return;
    }
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-resume-task", sessionId: activeSessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The browser task could not be resumed.");
      setDismissedTabId(suggestedTab.id);
    } catch (error) {
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: error instanceof Error ? error.message : "The browser task could not be resumed.",
      }]);
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function continueInBackground() {
    if (!suggestedTab || isSwitchingTab) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-continue-background", sessionId: activeSessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The browser task could not continue in the background.");
      setDismissedTabId(suggestedTab.id);
    } catch (error) {
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: error instanceof Error ? error.message : "The browser task could not continue in the background.",
      }]);
    } finally {
      setIsSwitchingTab(false);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">D</div>
        <div className="brand-copy">
          <p className="eyebrow">DeepSeek Harness</p>
          <h1>Browser Agent</h1>
        </div>
        <span className="connection-status">
          <span className="status-dot" aria-hidden="true" />
          {connectionStatus}
        </span>
        <span className="active-task-count" title="Active browser tasks">
          <span aria-hidden="true" />
          {agentTabState.activeTaskCount} active
        </span>
        <button className="history-button" type="button" onClick={() => setIsHistoryOpen((open) => !open)} aria-expanded={isHistoryOpen}>
          Chats {savedChats.length ? `(${savedChats.length})` : ""}
        </button>
        <button className="new-chat-button" type="button" onClick={() => void startNewSession()} disabled={isLoading || isStartingSession} aria-label="New chat">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.25a.75.75 0 0 1 .75.75v5.25H14a.75.75 0 0 1 0 1.5H8.75V14a.75.75 0 0 1-1.5 0V8.75H2a.75.75 0 0 1 0-1.5h5.25V2A.75.75 0 0 1 8 1.25Z" />
          </svg>
          {isStartingSession ? "Starting..." : "New chat"}
        </button>
      </header>

      {isHistoryOpen && (
        <section className="chat-history" aria-label="Saved chats">
          <div className="chat-history-header"><strong>Chats</strong><button type="button" onClick={() => void startNewSession()} disabled={isLoading}>New chat</button></div>
          {savedChats.length === 0 ? <p className="chat-history-empty">Your completed chats will appear here.</p> : (
            <ul>
              {savedChats.map((chat) => (
                <li key={chat.id} className={chat.id === activeSessionId ? "selected" : undefined}>
                  <button type="button" onClick={() => openSavedChat(chat)} disabled={isSwitchingTab}>
                    <span>{chat.title}</span>
                    <small>{chat.status === "active" ? "Active" : new Date(chat.updatedAt).toLocaleDateString()}</small>
                  </button>
                  {chat.links[0] && <a href={chat.links[0]} target="_blank" rel="noreferrer" title="Open last visited website">Open site</a>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {agentTabState.agentTabId !== undefined && (
        <section className="agent-tab-status" aria-label="Agent tab">
          <span className="agent-tab-dot" aria-hidden="true" />
          <span><strong>Agent tab</strong>{agentTabState.agentTab ? tabLabel(agentTabState.agentTab) : "Closed"}</span>
        </section>
      )}

      <section className="conversation" aria-label="Current chat">
        <div className="conversation-heading"><span>Current chat</span><span className="conversation-date">Today</span></div>
        {sessionNotice && <p className="session-notice" role="status">{sessionNotice}</p>}
        <div className="messages" ref={messagesRef} aria-live="polite">
          {messages.map((message) => message.kind === "message" ? (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">{message.role === "assistant" ? "D" : "Y"}</div>
              <div className="message-content">
                {message.role === "assistant" && <p className="message-author">DeepSeek Harness</p>}
                {message.role === "assistant" ? <MarkdownMessage text={message.text} /> : <p>{message.text}</p>}
              </div>
            </article>
          ) : (
            <section className="tool-thread" key={message.id} aria-label="Browser execution thread">
              <header className="tool-thread-header">
                <div className="tool-thread-title">
                  <span className="tool-thread-kicker">Execution thread</span>
                  <strong>Browser activity</strong>
                </div>
                <span className="tool-thread-meta">
                  {message.steps.length} {message.steps.length === 1 ? "step" : "steps"} · {statusLabel(toolThreadStatus(message.steps))}
                </span>
              </header>
              <div className="tool-thread-list">
                {message.steps.map((step, index) => <ToolStep key={step.callId} step={step} index={index} />)}
              </div>
            </section>
          ))}
        </div>
      </section>

      {suggestedTab && (
        <section className="tab-switch-prompt" role="dialog" aria-label="Switch agent tab" aria-live="assertive">
          <div>
            <strong>Switch agent to {tabLabel(suggestedTab)}?</strong>
            <p>{agentTabState.task?.status === "paused" && agentTabState.agentTab
              ? `Work on ${tabLabel(agentTabState.agentTab)} is paused until you choose.`
              : agentTabState.agentTab ? `The agent is assigned to ${tabLabel(agentTabState.agentTab)}.` : "The assigned tab was closed."}</p>
          </div>
          <div className="tab-switch-actions">
            {agentTabState.task && agentTabState.task.status !== "cancelled" && (
              <>
                <button type="button" onClick={() => void continueInBackground()} disabled={isSwitchingTab}>Continue in background</button>
                <button type="button" onClick={() => void pauseChatAndStartNew()} disabled={isSwitchingTab}>Pause and start new</button>
                <button type="button" onClick={() => void discardChatAndStartNew()} disabled={isSwitchingTab}>Quit and start new</button>
              </>
            )}
            <button className="tab-switch-primary" type="button" onClick={() => void moveAgentToCurrentTab()} disabled={isSwitchingTab}>
              {isSwitchingTab ? "Switching..." : agentTabState.task?.status === "paused" ? "Move chat here" : "Switch agent here"}
            </button>
          </div>
        </section>
      )}

      {pendingDestinationAction && destinationSavedChat() && (
        <section className="tab-switch-prompt" role="dialog" aria-label="Choose chat for this tab" aria-live="assertive">
          <div>
            <strong>This tab already has a saved chat.</strong>
            <p>Start a new chat here, or continue {destinationSavedChat()!.title}.</p>
          </div>
          <div className="tab-switch-actions">
            <button type="button" onClick={() => void resolveDestinationChoice(false)} disabled={isSwitchingTab}>Start new chat</button>
            <button className="tab-switch-primary" type="button" onClick={() => void resolveDestinationChoice(true)} disabled={isSwitchingTab}>Continue previous chat</button>
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

      <form className="composer" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="prompt">Message the browser agent</label>
        <textarea ref={textareaRef} id="prompt" name="prompt" rows={1} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} placeholder="Ask the browser agent..." autoComplete="off" />
        <div className="composer-footer">
          <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
          <button className="send-button" type="submit" aria-label="Send message" disabled={isLoading || connectionStatus !== "connected"}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14.7 1.3a.75.75 0 0 0-.78-.17l-12 4.5a.75.75 0 0 0 .05 1.42l5.07 1.69 1.69 5.07a.75.75 0 0 0 1.42.05l4.5-12a.75.75 0 0 0 .05-.56ZM8.3 8.76l-.68-2.04 4.42-2.21-3.74 4.25Zm.47 3.06-1.18-3.55 4.32-4.9-3.14 8.45Z" /></svg>
          </button>
        </div>
      </form>
    </main>
  );
}

function ToolStep({ step, index }: { step: ToolActivity; index: number }) {
  const [isOpen, setIsOpen] = useState(step.status === "running" || step.status === "error");

  useEffect(() => {
    if (step.status === "running" || step.status === "error") setIsOpen(true);
    if (step.status === "success") setIsOpen(false);
  }, [step.status]);

  return (
    <details
      className={`tool-step tool-step-${step.status}`}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="tool-step-marker" aria-label={`Step ${index + 1}, ${step.status}`}>
          <span className="tool-step-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="tool-status" aria-hidden="true" />
        </span>
        <span className="tool-step-main">
          <span className="tool-step-label">
            <span className="tool-glyph" aria-hidden="true">{toolGlyph(step.tool)}</span>
            <span className="tool-name">{toolLabel(step.tool)}</span>
          </span>
          <span className="tool-step-detail">{step.input ?? "Browser operation"}</span>
        </span>
        <span className="tool-result">{statusLabel(step.status)}</span>
        <span className="tool-chevron" aria-hidden="true">›</span>
      </summary>
      <dl className="tool-io">
        <div><dt>Input</dt><dd>{step.input ?? "No input"}</dd></div>
        <div><dt>Output</dt><dd>{step.error ?? step.output ?? "Working"}</dd></div>
      </dl>
    </details>
  );
}

function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    browser_snapshot: "Reading page", browser_wait: "Waiting for page", browser_screenshot: "Capturing screenshot", browser_scroll: "Scrolling page", browser_click: "Clicking element", browser_type: "Entering text", browser_navigate: "Opening page", browser_tabs: "Listing tabs",
  };
  return labels[tool] ?? "Using tool";
}

function toolGlyph(tool: string): string {
  const glyphs: Record<string, string> = {
    browser_snapshot: "◌", browser_wait: "◷", browser_screenshot: "▧", browser_scroll: "↕", browser_click: "⌁", browser_type: "T", browser_navigate: "↗", browser_tabs: "⊞",
  };
  return glyphs[tool] ?? "·";
}

function toolThreadStatus(steps: ToolActivity[]): ToolActivity["status"] {
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "error")) return "error";
  return "success";
}

function statusLabel(status: ToolActivity["status"]): string {
  return status === "running" ? "Working" : status === "success" ? "Done" : "Failed";
}

function tabLabel(tab?: TabSummary): string {
  if (!tab) return "the assigned tab";
  if (tab.title?.trim()) return tab.title.trim();
  if (tab.url) {
    try { return new URL(tab.url).hostname; } catch { return "this tab"; }
  }
  return "this tab";
}

function newSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

export default App;

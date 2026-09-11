import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { BridgeChatDelta, BridgeChatProgress } from "../../../../shared/protocol";
import { createAssistantStream, type StreamingAssistant } from "../assistant-stream";
import { chatTitle, collectHttpLinks, loadChatHistory, removeChat, saveChat, type ActivityGroup, type ChatDocument, type ChatImage, type ChatMessage, type ConversationItem, type SavedChat, type ToolActivity } from "../chat-history";
import { documentPromptContent } from "../document-attachments";
import { useAttachments } from "./useAttachments";
import { useThemePreference } from "./useThemePreference";
import { useToolSettings } from "./useToolSettings";
import { promptContent, type DraftImage } from "../image-attachments";
import { isHumanApprovalRequest, isUserQuestionRequest, type CurrentTaskAction, type HumanApprovalRequest, type UserQuestionRequest } from "../requests";
import { getTabSwitchView, type AgentTabState } from "../tab-switch-state";
import { isThemePreference, THEME_MENU_OPTIONS, themePreferenceFromCommand, themePreferenceFromMenuCommand, themePreferenceLabel, type ThemePreference } from "../theme";
import { AGENT_TOOL_DEFS, effectiveDenied } from "../tools";
import { buildTaskRunPrompt, loadSavedTasks, loadTaskSetup, removeSavedTask, removeTaskSetup, saveSavedTask, saveTaskSetup, type SavedTask } from "../saved-tasks";
import type { TaskDraft } from "../components/TaskDialogs";
import type { TaskDraftQuestion } from "../../../../shared/protocol";


// Session, streaming, and tab transitions share refs and stay coordinated here.
export function useSidepanelController(initialThemePreference: ThemePreference) {
  const { changeThemePreference } = useThemePreference(initialThemePreference);
  const [messages, setMessages] = useState<ConversationItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(() => newSessionId());
  const [sessionCreatedAt, setSessionCreatedAt] = useState(() => Date.now());
  const [sessionLinks, setSessionLinks] = useState<string[]>([]);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [savedTasks, setSavedTasks] = useState<SavedTask[]>([]);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>();
  const [taskDraftQuestions, setTaskDraftQuestions] = useState<TaskDraftQuestion[]>([]);
  const [taskDraftAnswers, setTaskDraftAnswers] = useState<Record<string, string>>({});
  const [taskSetupBusy, setTaskSetupBusy] = useState(false);
  const taskSetupConversation = useRef("");
  const [runningTask, setRunningTask] = useState<SavedTask>();
  const [historyReady, setHistoryReady] = useState(false);
  const { toolSettings, updateToolSettings, toggleToolForChat, resetChatTools, setEffectiveAsDefault, effectiveDeniedTools } = useToolSettings(activeSessionId, historyReady, savedChats);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string>();
  const [pendingDeleteChat, setPendingDeleteChat] = useState<SavedChat>();
  const [pendingSavedChat, setPendingSavedChat] = useState<SavedChat>();
  const [prompt, setPrompt] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [activePaletteIndex, setActivePaletteIndex] = useState(0);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [activeToolIndex, setActiveToolIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingAssistant, setStreamingAssistant] = useState<StreamingAssistant>();
  const [isStopping, setIsStopping] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [sessionNotice, setSessionNotice] = useState("");
  const { draftImages, setDraftImages, draftDocuments, setDraftDocuments, isAddingImage, imageInputRef, documentInputRef, addImageFiles, addAttachmentFiles } = useAttachments(isLoading, setSessionNotice);
  const [agentTabState, setAgentTabState] = useState<AgentTabState>({ activeTaskCount: 0 });
  const [humanInTheLoopSessions, setHumanInTheLoopSessions] = useState<Set<string>>(() => new Set());
  const [pendingHumanApproval, setPendingHumanApproval] = useState<HumanApprovalRequest>();
  const [pendingUserQuestion, setPendingUserQuestion] = useState<UserQuestionRequest>();
  const [userQuestionText, setUserQuestionText] = useState("");
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [dismissedTabId, setDismissedTabId] = useState<number>();
  const activeChatIds = useRef(new Set<string>());
  const activeChatSessions = useRef(new Map<string, string>());
  const activeChatIdBySession = useRef(new Map<string, string>());
  const assistantPrefixByChat = useRef(new Map<string, string>());
  const assistantAfterActivity = useRef(new Set<string>());
  const assistantStreamRef = useRef<ReturnType<typeof createAssistantStream> | undefined>(undefined);
  const stoppedChatIds = useRef(new Set<string>());
  const activeSessionIdRef = useRef(activeSessionId);
  const historyRef = useRef<SavedChat[]>([]);
  const sessionItemsRef = useRef(new Map<string, ConversationItem[]>());
  const sessionLinksRef = useRef(new Map<string, string[]>());
  const sessionCreatedAtRef = useRef(new Map<string, number>());
  const sessionStatusRef = useRef(new Map<string, SavedChat["status"]>());
  const sessionTaskRunsRef = useRef(new Map<string, NonNullable<SavedChat["taskRun"]>>());
  const deletedSessionIds = useRef(new Set<string>());
  const currentTabId = useRef<number | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageImageDataRef = useRef(new Map<string, DraftImage[]>());
  const messagesRef = useRef<HTMLDivElement>(null);

  activeSessionIdRef.current = activeSessionId;

  if (!assistantStreamRef.current) {
    assistantStreamRef.current = createAssistantStream(setStreamingAssistant);
  }

  function appendAssistantDelta(delta: BridgeChatDelta) {
    const sessionId = activeChatSessions.current.get(delta.id);
    if (!sessionId) return;
    assistantStreamRef.current?.append({ id: delta.id, sessionId, text: delta.text });
  }

  function clearAssistantStream(chatId?: string) {
    assistantStreamRef.current?.clear(chatId);
  }

  async function finishAssistantStream(chatId: string, text: string) {
    await assistantStreamRef.current?.finish(chatId, text);
  }

  function assistantReplyAfterPrefix(chatId: string, text: string): string {
    const prefix = assistantPrefixByChat.current.get(chatId);
    if (!prefix || !text.startsWith(prefix)) return text;
    return text.slice(prefix.length).replace(/^\s+/, "");
  }

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
      ...(sessionTaskRunsRef.current.get(sessionId) ?? existing?.taskRun ? { taskRun: sessionTaskRunsRef.current.get(sessionId) ?? existing?.taskRun } : {}),
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
    if (toolSettings.deniedByChat[sessionId] !== undefined) {
      const deniedByChat = { ...toolSettings.deniedByChat };
      delete deniedByChat[sessionId];
      updateToolSettings({ version: 3, deniedDefault: toolSettings.deniedDefault, deniedByChat });
    }
    syncSavedChats(historyRef.current.filter((chat) => chat.id !== sessionId));
    return removeChat(sessionId);
  }

  function applyAgentTabState(state: AgentTabState) {
    if (state.currentTab?.id !== currentTabId.current) {
      setDismissedTabId(undefined);
    }
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
    messagesRef.current?.lastElementChild?.scrollIntoView({ behavior: streamingAssistant ? "auto" : "smooth" });
  }, [messages, streamingAssistant]);

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
        if (chat.taskRun) sessionTaskRunsRef.current.set(chat.id, chat.taskRun);
      }
      historyRef.current = merged;
      setSavedChats(merged);
      setHistoryReady(true);
    });
  }, []);

  useEffect(() => {
    const refresh = () => void loadSavedTasks().then(setSavedTasks);
    refresh();
    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === "local" && changes.dshBrowserSavedTasksV1) refresh();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);
  useEffect(() => {
    void loadTaskSetup().then((record) => {
      if (!record) return;
      taskSetupConversation.current = record.conversation;
      if (record.draft) setTaskDraft(record.draft as TaskDraft);
      setTaskDraftQuestions(record.questions);
      setTaskDraftAnswers(record.answers);
    });
  }, []);
  useEffect(() => {
    if (!taskDraft || !taskSetupConversation.current) return;
    void saveTaskSetup({ sourceSessionId: activeSessionId, conversation: taskSetupConversation.current, draft: taskDraft, questions: taskDraftQuestions, answers: taskDraftAnswers, updatedAt: Date.now() });
  }, [activeSessionId, taskDraft, taskDraftAnswers, taskDraftQuestions]);

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
    const onMessage = (message: { type?: string; status?: string; delta?: BridgeChatDelta; progress?: BridgeChatProgress; state?: AgentTabState; sessionId?: string; approval?: unknown; question?: unknown }) => {
      if (message.type === "dsh-bridge-status" && message.status) {
        setConnectionStatus(message.status);
      } else if (message.type === "dsh-chat-delta" && message.delta && activeChatIds.current.has(message.delta.id)) {
        appendAssistantDelta(message.delta);
      } else if (message.type === "dsh-chat-progress" && message.progress && activeChatIds.current.has(message.progress.id)) {
        const sessionId = activeChatSessions.current.get(message.progress.id);
        if (sessionId) addToolProgress(sessionId, message.progress);
      } else if (message.type === "dsh-agent-tab-state" && message.state && message.sessionId === activeSessionIdRef.current) {
        applyAgentTabState(message.state);
      } else if (message.type === "dsh-human-approval-request" && isHumanApprovalRequest(message.approval) && activeChatIds.current.has(message.approval.chatId)) {
        setPendingHumanApproval(message.approval);
      } else if (message.type === "dsh-user-question-request" && isUserQuestionRequest(message.question) && activeChatIds.current.has(message.question.chatId)) {
        setUserQuestionText("");
        setPendingUserQuestion(message.question);
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

  const tabSwitchView = getTabSwitchView({
    state: agentTabState,
    activeSessionId,
    savedSessionIds: new Set(savedChats.map((chat) => chat.id)),
    historyReady,
    dismissedTabId,
  });
  // A chat already assigned to the visible tab is restored automatically.
  const destinationSessionId = tabSwitchView.kind === "saved-chat" ? tabSwitchView.sessionId : undefined;

  useEffect(() => {
    if (!historyReady || isLoading || !destinationSessionId) return;
    const chat = savedChats.find((candidate) => candidate.id === destinationSessionId);
    if (chat) activateSavedChat(chat);
  }, [destinationSessionId, historyReady, isLoading, savedChats]);

  /**
   * Folds one bridge progress event into the current activity group.
   *
   * Progress arrives as pairs of events per tool call:
   *   tool_started  -> creates/updates the step as "running" + stamps startedAt
   *   tool_finished -> flips it to "success" and freezes durationMs
   *   tool_failed   -> flips it to "error" (also freezes durationMs)
   * The side panel is the clock: the bridge sends no timestamps, so we
   * measure elapsed time between the two events here.
   */
  function addToolProgress(sessionId: string, progress: BridgeChatProgress) {
    const activityId = `${progress.id}:${progress.callId}`;
    let streamedSegment = "";
    if (progress.phase === "tool_started") {
      streamedSegment = assistantStreamRef.current?.getTarget(progress.id) ?? "";
      if (streamedSegment) {
        const previousPrefix = assistantPrefixByChat.current.get(progress.id) ?? "";
        assistantPrefixByChat.current.set(progress.id, previousPrefix + streamedSegment);
      }
      assistantAfterActivity.current.add(progress.id);
      // Each tool boundary closes the current assistant segment. The next
      // delta will render after this tool, preserving text/tool interleaving.
      assistantStreamRef.current?.clear(progress.id);
    }
    updateConversation(sessionId, (currentMessages) => {
      const groupIndex = currentMessages.findIndex((item) => item.kind === "activity" && item.id === activityId);
      const now = Date.now();
      const finished = progress.phase !== "tool_started";
      const step: ToolActivity = {
        callId: progress.callId,
        tool: progress.tool,
        ...(progress.detail ? { input: progress.detail } : {}),
        ...(progress.output ? { output: progress.output } : {}),
        status: progress.phase === "tool_started" ? "running" : progress.phase === "tool_finished" ? "success" : "error",
        ...(progress.error ? { error: progress.error } : {}),
        ...(progress.phase === "tool_started" ? { startedAt: now } : {}),
      };
      if (groupIndex === -1) {
        return [
          ...currentMessages,
          ...(streamedSegment ? [{ kind: "message" as const, id: crypto.randomUUID(), role: "assistant" as const, text: streamedSegment }] : []),
          { kind: "activity", id: activityId, steps: [step] },
        ];
      }

      const group = currentMessages[groupIndex] as ActivityGroup;
      const existingIndex = group.steps.findIndex((candidate) => candidate.callId === progress.callId);
      const steps = existingIndex === -1
        ? [...group.steps, step]
        : group.steps.map((candidate, index) => index === existingIndex
          ? {
              ...candidate,
              ...step,
              input: step.input ?? candidate.input,
              output: step.output ?? candidate.output,
              // Freeze the elapsed time now that the call finished.
              ...(finished && candidate.startedAt !== undefined ? { durationMs: Math.max(0, now - candidate.startedAt) } : {}),
            }
          : candidate);
      return currentMessages.map((item, index) => index === groupIndex ? { ...group, steps } : item);
    }, "active");
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if ((!text && draftImages.length === 0 && draftDocuments.length === 0) || isLoading || isAddingImage) return;

    if (text.startsWith("/") && draftImages.length === 0 && draftDocuments.length === 0) {
      const commandParts = text.slice(1).trim().toLowerCase().split(/\s+/).filter(Boolean);
      const cmd = commandParts[0] ?? "";
      const args = commandParts.slice(1);
      // Accept exact ("/actions") and unambiguous prefix ("/act") matches.
      const candidates = cmd ? slashCommands.filter((c) => c.id.startsWith(cmd)) : [];
      const matched = candidates.find((c) => c.id === cmd) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (matched) {
        executeSlashCommand(matched.id, args);
        return;
      }
      setPrompt("");
      setSessionNotice(commandParts.length > 0
        ? `Unknown command "/${commandParts.join(" ")}". Available: ${slashCommands.map((c) => c.label).join(", ")}`
        : `Type a command: ${slashCommands.map((c) => c.label).join(" or ")}.`);
      return;
    }

    if (connectionStatus !== "connected") {
      setSessionNotice("Start DSH to send this message. Your new chat is ready when it reconnects.");
      return;
    }

    const id = crypto.randomUUID();
    const sessionId = activeSessionId;
    const resume = messages.length > 0;
    const submittedImages = draftImages;
    const submittedDocuments = draftDocuments;
    const content = [...promptContent(text, submittedImages), ...documentPromptContent(submittedDocuments)];
    const userMessageId = crypto.randomUUID();
    const imageMetadata: ChatImage[] = submittedImages.map(({ id: imageId, mediaType, bytes, width, height, name }) => ({
      id: imageId, mediaType, bytes, width, height, ...(name ? { name } : {}),
    }));
    const documentMetadata: ChatDocument[] = submittedDocuments.map(({ id: documentId, name, extension, bytes }) => ({
      id: documentId, name, extension, bytes,
    }));
    if (submittedImages.length > 0) messageImageDataRef.current.set(userMessageId, submittedImages);
    setIsLoading(true);
    clearAssistantStream();
    try {
      activeChatIds.current.add(id);
      activeChatSessions.current.set(id, sessionId);
      activeChatIdBySession.current.set(sessionId, id);
      updateConversation(sessionId, (currentMessages) => [...currentMessages, { kind: "message", id: userMessageId, role: "user", text, ...(imageMetadata.length > 0 ? { images: imageMetadata } : {}), ...(documentMetadata.length > 0 ? { documents: documentMetadata } : {}) }], "active");
      setPrompt("");
      setDraftImages([]);
      setDraftDocuments([]);
      setSessionNotice("");
      const response = await chrome.runtime.sendMessage({ type: "dsh-chat", id, text, content, sessionId, resume, deniedTools: effectiveDenied(toolSettings, sessionId), humanInTheLoop: humanInTheLoopSessions.has(sessionId) }) as { ok?: boolean; text?: string; error?: string; displacedSessionIds?: string[] };
      if (!response?.ok) {
        setDraftImages(submittedImages);
        setDraftDocuments(submittedDocuments);
      }
      await forgetDisplacedSessions(response?.displacedSessionIds, sessionId);
      const assistantText = response?.ok && response.text ? assistantReplyAfterPrefix(id, response.text) : response?.text;
      if (response?.ok && assistantText) await finishAssistantStream(id, assistantText);
      clearAssistantStream(id);
      setPendingUserQuestion(undefined);
      if (!stoppedChatIds.current.has(id)) {
        updateConversation(sessionId, (currentMessages) => [...currentMessages, {
          kind: "message",
          id: crypto.randomUUID(),
          role: "assistant",
          text: response?.ok && assistantText ? assistantText : `I couldn't complete that request: ${response?.error ?? "The DSH bridge is unavailable."}`,
        }], sessionStatusRef.current.get(sessionId) === "paused" ? "paused" : response?.ok ? "completed" : "interrupted");
      }
    } catch (error) {
      clearAssistantStream(id);
      if (submittedImages.length > 0) setDraftImages(submittedImages);
      if (submittedDocuments.length > 0) setDraftDocuments(submittedDocuments);
      setPendingUserQuestion(undefined);
      if (!stoppedChatIds.current.has(id)) {
        updateConversation(sessionId, (currentMessages) => [...currentMessages, {
          kind: "message",
          id: crypto.randomUUID(),
          role: "assistant",
          text: error instanceof Error ? error.message : "The snapshot bridge is unavailable.",
        }], sessionStatusRef.current.get(sessionId) === "paused" ? "paused" : "interrupted");
      }
    } finally {
      activeChatIds.current.delete(id);
      activeChatSessions.current.delete(id);
      assistantPrefixByChat.current.delete(id);
      assistantAfterActivity.current.delete(id);
      const isCurrentChat = activeChatIdBySession.current.get(sessionId) === id;
      if (isCurrentChat) activeChatIdBySession.current.delete(sessionId);
      stoppedChatIds.current.delete(id);
      if (activeSessionIdRef.current === sessionId && isCurrentChat) setIsLoading(false);
    }
  }

  async function stopMessage() {
    const sessionId = activeSessionIdRef.current;
    const id = activeChatIdBySession.current.get(sessionId);
    if (!id || isStopping) return;

    stoppedChatIds.current.add(id);
    clearAssistantStream(id);
    setPendingUserQuestion(undefined);
    setIsStopping(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-pause-chat", sessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The agent could not be stopped.");
      setSessionStatus(sessionId, "paused");
      setSessionNotice("Agent stopped. Send a message to continue.");
      setIsLoading(false);
    } catch (error) {
      stoppedChatIds.current.delete(id);
      setSessionNotice(error instanceof Error ? error.message : "The agent could not be stopped.");
    } finally {
      setIsStopping(false);
    }
  }

  /**
   * "/new" and the header + button.
   *
   * Stops any running task, DELETES the current chat (history + storage),
   * then creates a fresh session that claims this tab directly — so the
   * "this tab already has a saved chat" prompt never appears.
   */
  async function startNewSession() {
    if (isStartingSession) return;
    setIsStartingSession(true);
    try {
      const previousSessionId = activeSessionId;
      clearAssistantStream();
      setPendingUserQuestion(undefined);
      // Best-effort stop: discard the agent task even if it's mid-flight.
      await chrome.runtime.sendMessage({ type: "dsh-agent-discard-chat", sessionId: previousSessionId }).catch(() => undefined);
      await forgetSession(previousSessionId);
      setIsLoading(false);
    } finally {
      setIsStartingSession(false);
    }
    await startFreshChatOnCurrentTab();
  }

  async function startFreshChatOnCurrentTab() {
    const sessionId = newSessionId();
    const createdAt = Date.now();
    deletedSessionIds.current.delete(sessionId);
    sessionCreatedAtRef.current.set(sessionId, createdAt);
    sessionItemsRef.current.set(sessionId, []);
    sessionLinksRef.current.set(sessionId, []);
    updateToolSettings({
      version: 3,
      deniedDefault: toolSettings.deniedDefault,
      deniedByChat: { ...toolSettings.deniedByChat, [sessionId]: [...toolSettings.deniedDefault] },
    });
    setActiveSessionId(sessionId);
    setSessionCreatedAt(createdAt);
    setMessages([]);
    setSessionLinks([]);
    setPrompt("");
    setDraftImages([]);
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

  function currentTabSavedChat(): SavedChat | undefined {
    const sessionId = agentTabState.currentTabSessionId;
    return sessionId && sessionId !== activeSessionId
      ? historyRef.current.find((chat) => chat.id === sessionId)
      : undefined;
  }

  async function resolveCurrentTask(action: CurrentTaskAction) {
    const sessionId = activeSessionId;
    setIsSwitchingTab(true);
    try {
      const type = action === "background"
        ? "dsh-agent-continue-background"
        : action === "pause" ? "dsh-agent-pause-chat" : "dsh-agent-discard-chat";
      const response = await chrome.runtime.sendMessage({ type, sessionId }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The current chat could not be changed.");

      if (action === "pause") setSessionStatus(sessionId, "paused");
      if (action === "quit") await forgetSession(sessionId);
      setIsLoading(false);

      const savedChat = currentTabSavedChat();
      if (savedChat) activateSavedChat(savedChat);
      else await startFreshChatOnCurrentTab();
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The current chat could not be changed.");
    } finally {
      setIsSwitchingTab(false);
    }
  }

  async function startNewOnDestination() {
    await startFreshChatOnCurrentTab();
  }

  function activateSavedChat(chat: SavedChat) {
    deletedSessionIds.current.delete(chat.id);
    sessionItemsRef.current.set(chat.id, chat.items);
    sessionLinksRef.current.set(chat.id, chat.links);
    sessionCreatedAtRef.current.set(chat.id, chat.createdAt);
    sessionStatusRef.current.set(chat.id, chat.status);
    if (chat.taskRun) sessionTaskRunsRef.current.set(chat.id, chat.taskRun);
    setActiveSessionId(chat.id);
    setSessionCreatedAt(chat.createdAt);
    setMessages(chat.items);
    setSessionLinks(chat.links);
    setPrompt("");
    setDraftImages([]);
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
    const hasForegroundTask = agentTabState.task !== undefined &&
      agentTabState.task.status !== "cancelled" &&
      agentTabState.task.runMode === "foreground";
    if (isLoading || hasForegroundTask) {
      setPendingSavedChat(chat);
      return;
    }
    activateSavedChat(chat);
  }

  async function saveCurrentAsTask() {
    if (isLoading || taskSetupBusy || messages.length === 0) return;
    const conversation = messages.filter((item): item is ChatMessage => item.kind === "message").map((item) => `${item.role}: ${item.text.trim()}`).filter(Boolean).join("\n\n");
    const url = agentTabState.agentTab?.url;
    let savedUrl: string | undefined;
    try {
      if (url) {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") savedUrl = parsed.href;
      }
    } catch { /* The task can still run from the current page. */ }
    taskSetupConversation.current = `Starting URL: ${savedUrl ?? "(current page)"}\n\n${conversation.slice(-20_000)}`;
    void saveTaskSetup({ sourceSessionId: activeSessionId, conversation: taskSetupConversation.current, questions: [], answers: {}, updatedAt: Date.now() });
    setTaskSetupBusy(true);
    setTaskDraftQuestions([]);
    setTaskDraftAnswers({});
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-task-draft", sourceSessionId: activeSessionId, conversation: taskSetupConversation.current, ...(savedUrl ? { currentUrl: savedUrl } : {}) }) as { ok?: boolean; draft?: { status: "needs-input" | "ready"; draft: Omit<TaskDraft, "id" | "version" | "revision" | "deniedTools" | "humanInTheLoop">; questions: TaskDraftQuestion[] }; error?: string };
      if (!response?.ok || !response.draft) throw new Error(response?.error ?? "The task builder could not create a draft.");
      setTaskDraft({ version: 2, revision: 1, ...response.draft.draft, deniedTools: effectiveDenied(toolSettings, activeSessionId), humanInTheLoop: humanInTheLoopSessions.has(activeSessionId) });
      setTaskDraftQuestions(response.draft.questions);
      void saveTaskSetup({ sourceSessionId: activeSessionId, conversation: taskSetupConversation.current, draft: { version: 2, revision: 1, ...response.draft.draft, deniedTools: effectiveDenied(toolSettings, activeSessionId), humanInTheLoop: humanInTheLoopSessions.has(activeSessionId) }, questions: response.draft.questions, answers: {}, updatedAt: Date.now() });
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The task builder could not create a draft.");
    } finally {
      setTaskSetupBusy(false);
    }
  }

  async function continueTaskSetup() {
    if (!taskDraft || taskSetupBusy) return;
    if (taskDraftQuestions.some((question) => !taskDraftAnswers[question.id]?.trim())) {
      setSessionNotice("Please answer each setup question before continuing.");
      return;
    }
    setTaskSetupBusy(true);
    try {
      const conversation = `${taskSetupConversation.current}\n\nCurrent user-edited draft (preserve edits):\n${JSON.stringify(taskDraft)}\n\nQuestions and answers:\n${JSON.stringify(taskDraftQuestions.map((question) => ({ ...question, answer: taskDraftAnswers[question.id] })))}`;
      const response = await chrome.runtime.sendMessage({ type: "dsh-task-draft", sourceSessionId: activeSessionId, conversation, answers: taskDraftAnswers }) as { ok?: boolean; draft?: { status: "needs-input" | "ready"; draft: Omit<TaskDraft, "id" | "version" | "revision" | "deniedTools" | "humanInTheLoop">; questions: TaskDraftQuestion[] }; error?: string };
      if (!response?.ok || !response.draft) throw new Error(response?.error ?? "The task builder could not continue.");
      setTaskDraft({ version: 2, revision: taskDraft.revision, ...response.draft.draft, deniedTools: taskDraft.deniedTools, humanInTheLoop: taskDraft.humanInTheLoop, ...(taskDraft.id ? { id: taskDraft.id } : {}) });
      setTaskDraftQuestions(response.draft.questions);
      void saveTaskSetup({ sourceSessionId: activeSessionId, conversation: taskSetupConversation.current, draft: { version: 2, revision: taskDraft.revision, ...response.draft.draft, deniedTools: taskDraft.deniedTools, humanInTheLoop: taskDraft.humanInTheLoop, ...(taskDraft.id ? { id: taskDraft.id } : {}) }, questions: response.draft.questions, answers: taskDraftAnswers, updatedAt: Date.now() });
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The task builder could not continue.");
    } finally {
      setTaskSetupBusy(false);
    }
  }

  async function saveTask() {
    if (!taskDraft || !taskDraft.name.trim() || !taskDraft.instructions.trim()) return;
    const now = Date.now();
    const existing = taskDraft.id ? savedTasks.find((candidate) => candidate.id === taskDraft.id) : undefined;
    const expectedRevision = taskDraft.id ? taskDraft.revision : 0;
    const task: SavedTask = { ...taskDraft, id: taskDraft.id ?? `task-${crypto.randomUUID()}`, revision: expectedRevision + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };
    try {
      await saveSavedTask(task, expectedRevision);
      setSavedTasks(await loadSavedTasks());
      setTaskDraft(undefined);
      await removeTaskSetup();
      setSessionNotice(`Saved task "${task.name}".`);
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The task could not be saved.");
    }
  }

  function editSavedTask(task: SavedTask) { setTaskDraftQuestions([]); setTaskDraftAnswers({}); setTaskDraft(structuredClone(task)); }

  async function deleteSavedTask(task: SavedTask) {
    try {
      await removeSavedTask(task.id);
      setSavedTasks((current) => current.filter((candidate) => candidate.id !== task.id));
      setSessionNotice(`Deleted task "${task.name}".`);
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The task could not be deleted.");
    }
  }

  function runSavedTask(task: SavedTask) { setRunningTask(task); }

  async function runTaskWithInputs(task: SavedTask, values: Record<string, string>) {
    let runPrompt: string;
    try { runPrompt = buildTaskRunPrompt(task, values); } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "Invalid task inputs.");
      return;
    }
    const missing = task.parameters.filter((parameter) => parameter.mode === "run" && parameter.required && !values[parameter.id]?.trim());
    if (missing.length > 0) {
      setSessionNotice(`Please provide: ${missing.map((parameter) => parameter.label).join(", ")}.`);
      return;
    }
    setRunningTask(undefined);
    const sessionId = newSessionId();
    const createdAt = Date.now();
    deletedSessionIds.current.delete(sessionId);
    sessionCreatedAtRef.current.set(sessionId, createdAt);
    sessionItemsRef.current.set(sessionId, []);
    sessionLinksRef.current.set(sessionId, []);
    sessionStatusRef.current.set(sessionId, "active");
    sessionTaskRunsRef.current.set(sessionId, {
      taskId: task.id,
      taskRevision: task.revision,
      taskSnapshot: structuredClone(task),
      inputValues: { ...values },
      target: task.startingContext.kind === "url" ? { kind: "url", url: task.startingContext.url } : { kind: "tab", url: agentTabState.agentTab?.url },
      startedAt: createdAt,
    });
    setActiveSessionId(sessionId);
    setSessionCreatedAt(createdAt);
    setMessages([]);
    setSessionLinks([]);
    setIsHistoryOpen(false);
    const userMessageId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    activeChatIds.current.add(requestId);
    activeChatSessions.current.set(requestId, sessionId);
    activeChatIdBySession.current.set(sessionId, requestId);
    setIsLoading(true);
    const initialItems: ConversationItem[] = [{ kind: "message", id: userMessageId, role: "user", text: runPrompt }];
    sessionItemsRef.current.set(sessionId, initialItems);
    setMessages(initialItems);
    persistSession(sessionId, "active");
    try {
      if (task.startingContext.kind === "url" && task.startingContext.url) {
        const focusResponse = await chrome.runtime.sendMessage({ type: "dsh-agent-focus-chat", sessionId, url: task.startingContext.url }) as { ok?: boolean; error?: string };
        if (!focusResponse?.ok) throw new Error(focusResponse?.error ?? "The task starting page could not be opened.");
      }
      const response = await chrome.runtime.sendMessage({ type: "dsh-chat", id: requestId, text: runPrompt, sessionId, resume: false, deniedTools: task.deniedTools, humanInTheLoop: task.humanInTheLoop }) as { ok?: boolean; text?: string; error?: string };
      if (response?.text) await finishAssistantStream(requestId, response.text);
      updateConversation(sessionId, (items) => [...items, { kind: "message", id: crypto.randomUUID(), role: "assistant", text: response?.ok ? (response.text ?? "Task completed.") : `Task could not complete: ${response?.error ?? "Unknown error"}` }], response?.ok ? "completed" : "interrupted");
    } catch (error) {
      updateConversation(sessionId, (items) => [...items, { kind: "message", id: crypto.randomUUID(), role: "assistant", text: error instanceof Error ? error.message : "The saved task failed." }], "interrupted");
    } finally {
      activeChatIds.current.delete(requestId); activeChatSessions.current.delete(requestId); activeChatIdBySession.current.delete(sessionId); setIsLoading(false);
    }
  }

  async function deleteSavedChat(chat: SavedChat) {
    if (deletingChatId || (chat.id === activeSessionId && isLoading)) return;
    setDeletingChatId(chat.id);
    try {
      await forgetSession(chat.id);
      if (chat.id === activeSessionId) await startNewSession();
      setSessionNotice("Chat deleted from history.");
    } catch (error) {
      setSessionNotice(error instanceof Error ? error.message : "The chat could not be deleted.");
    } finally {
      setDeletingChatId(undefined);
      setPendingDeleteChat(undefined);
    }
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
    const targetTab = tabSwitchView.kind === "active-task" || tabSwitchView.kind === "new-tab" ? tabSwitchView.tab : undefined;
    if (targetTab?.id === undefined || isSwitchingTab) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-switch-tab", id: targetTab.id, sessionId: activeSessionId }) as { ok?: boolean; error?: string; displacedSessionIds?: string[] };
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

  function keepCurrentChat() {
    const tabId = agentTabState.currentTab?.id;
    if (tabId !== undefined) setDismissedTabId(tabId);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (toolsMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActiveToolIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + AGENT_TOOL_DEFS.length) % AGENT_TOOL_DEFS.length;
      });
      return;
    }
    if (paletteVisible && paletteMatches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActivePaletteIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + paletteMatches.length) % paletteMatches.length;
      });
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (toolsMenuOpen) {
        const activeTool = AGENT_TOOL_DEFS[activeToolIndex];
        if (activeTool) toggleToolForChat(activeTool.name);
        return;
      }
      // While the palette is open, Enter runs the highlighted command even
      // if the word is only partially typed (e.g. "/act" -> /actions).
      if (paletteVisible && paletteActive) {
        executeSlashCommand(paletteActive.id);
        return;
      }
      event.currentTarget.form?.requestSubmit();
    }
    if (event.key === "Escape") {
      if (toolsMenuOpen) setToolsMenuOpen(false);
      else if (themeMenuOpen) setThemeMenuOpen(false);
      else if (prompt.trim().startsWith("/")) setPrompt("");
    }
  }

  const slashCommands: { id: string; label: string; description: string }[] = [
    { id: "new", label: "/new", description: "Delete this chat and start a fresh session in the tab" },
    { id: "actions", label: "/actions", description: "Enable or disable the agent's tools" },
    { id: "human-in-the-loop", label: "/human-in-the-loop", description: "Ask for approval before clicks, typing, and navigation" },
    { id: "theme", label: "/theme", description: "Set the panel theme: system, light, or dark" },
  ];

  function executeSlashCommand(commandId: string, args: string[] = []) {
    setPrompt("");
    setActivePaletteIndex(0);
    const menuTheme = themePreferenceFromMenuCommand(commandId);
    if (menuTheme) {
      setThemeMenuOpen(false);
      changeThemePreference(menuTheme);
      setSessionNotice(`Theme set to ${themePreferenceLabel(menuTheme).toLowerCase()}.`);
      textareaRef.current?.focus();
      return;
    }
    if (commandId === "new") {
      setThemeMenuOpen(false);
      setToolsMenuOpen(false);
      void startNewSession();
    } else if (commandId === "actions") {
      setThemeMenuOpen(false);
      setActiveToolIndex(0);
      setToolsMenuOpen(true);
      textareaRef.current?.focus();
    } else if (commandId === "human-in-the-loop") {
      setThemeMenuOpen(false);
      setHumanInTheLoopSessions((current) => new Set(current).add(activeSessionId));
      setSessionNotice("Human-in-the-loop is enabled for this chat. Clicks, typing, and navigation now require your approval.");
      textareaRef.current?.focus();
    } else if (commandId === "theme") {
      const nextTheme = themePreferenceFromCommand(args);
      if (nextTheme) {
        setThemeMenuOpen(false);
        changeThemePreference(nextTheme);
        setSessionNotice(`Theme set to ${themePreferenceLabel(nextTheme).toLowerCase()}.`);
      } else if (args.length === 0) {
        setThemeMenuOpen(true);
      } else if (args.length === 1 && !isThemePreference(args[0])) {
        setThemeMenuOpen(false);
        setSessionNotice(`Unknown theme "${args[0]}". Use system, light, or dark.`);
      } else {
        setThemeMenuOpen(false);
        setSessionNotice("Use /theme system, /theme light, or /theme dark.");
      }
      textareaRef.current?.focus();
    }
  }

  function updateComposerPrompt(value: string | ((current: string) => string)) {
    setPrompt(value);
    setThemeMenuOpen(false);
  }

  function respondToHumanApproval(approved: boolean) {
    const approval = pendingHumanApproval;
    if (!approval) return;
    setPendingHumanApproval(undefined);
    void chrome.runtime.sendMessage({ type: "dsh-human-approval-response", approvalId: approval.approvalId, approved });
  }

  function respondToUserQuestion(answer?: string) {
    const question = pendingUserQuestion;
    if (!question) return;
    const trimmedAnswer = answer?.trim();
    if (trimmedAnswer === "") return;
    setPendingUserQuestion(undefined);
    setUserQuestionText("");
    void chrome.runtime.sendMessage({
      type: "dsh-user-question-response",
      questionId: question.questionId,
      chatId: question.chatId,
      ...(trimmedAnswer ? { answer: trimmedAnswer } : { cancelled: true }),
    }).then((response: { ok?: boolean; error?: string }) => {
      if (!response?.ok) {
        setPendingUserQuestion(question);
        setSessionNotice(response?.error ?? "The answer could not be sent.");
      }
    }).catch(() => {
      setPendingUserQuestion(question);
      setSessionNotice("The answer could not be sent.");
    });
  }

  const trimmedPrompt = prompt.trim();
  const showingThemeMenu = themeMenuOpen && trimmedPrompt === "";
  const paletteVisible = !toolsMenuOpen && (showingThemeMenu || trimmedPrompt.startsWith("/"));
  const paletteMatches = paletteVisible
    ? showingThemeMenu
      ? THEME_MENU_OPTIONS
      : slashCommands.filter((c) => c.id.startsWith(trimmedPrompt.slice(1).trim().toLowerCase()))
    : [];
  const paletteActive = paletteMatches[activePaletteIndex] ?? paletteMatches[0];

  return {
    panelHeader: {
      connectionStatus,
      agentTabState,
      setIsHistoryOpen,
      isHistoryOpen,
      startNewSession,
      isStartingSession,
      saveCurrentAsTask,
    },
    chatHistory: {
      isHistoryOpen,
      startNewSession,
      isStartingSession,
      savedChats,
      activeSessionId,
      openSavedChat,
      isSwitchingTab,
      setPendingDeleteChat,
      deletingChatId,
      isLoading,
      savedTasks,
      runSavedTask,
      editSavedTask,
      deleteSavedTask,
    },
    conversation: {
      sessionNotice,
      messagesRef,
      streamingAssistant,
      activeSessionId,
      assistantAfterActivity,
      messages,
      messageImageDataRef,
    },
    tabSwitchPrompts: {
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
    },
    chatDialogs: {
      pendingDeleteChat,
      deletingChatId,
      setPendingDeleteChat,
      deleteSavedChat,
      pendingUserQuestion,
      respondToUserQuestion,
      userQuestionText,
      setUserQuestionText,
      pendingHumanApproval,
      respondToHumanApproval,
    },
    taskDialogs: {
      notice: sessionNotice,
      draft: taskDraft,
      setDraft: setTaskDraft,
      saveTask,
      close: () => { setTaskDraft(undefined); setTaskDraftQuestions([]); setTaskDraftAnswers({}); taskSetupConversation.current = ""; void removeTaskSetup(); },
      runningTask,
      setRunningTask,
      runTaskWithInputs,
      questions: taskDraftQuestions,
      answers: taskDraftAnswers,
      setAnswers: setTaskDraftAnswers,
      continueSetup: continueTaskSetup,
      setupBusy: taskSetupBusy,
    },
    toolPermissions: {
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
    },
    composer: {
      paletteVisible,
      paletteMatches,
      paletteActive,
      themeMenuOpen: showingThemeMenu,
      executeSlashCommand,
      isAddingImage,
      sendMessage,
      isLoading,
      addAttachmentFiles,
      draftImages,
      setDraftImages,
      draftDocuments,
      setDraftDocuments,
      textareaRef,
      prompt,
      setPrompt: updateComposerPrompt,
      setActivePaletteIndex,
      handlePromptKeyDown,
      addImageFiles,
      imageInputRef,
      documentInputRef,
      attachmentMenuOpen,
      setAttachmentMenuOpen,
      toolsMenuOpen,
      stopMessage,
      isStopping,
      connectionStatus,
    },
    saveCurrentAsTask,
    agentTabState,
  };
}

function newSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

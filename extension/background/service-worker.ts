import { ExtensionBridge, type BridgeConfiguration } from "./bridge";
import { captureBrowserScreenshot, captureBrowserSnapshot, clickBrowserRef, listBrowserTabs, navigateBrowser, scrollBrowser, typeBrowserRef, waitForBrowserSettled } from "./browser-snapshot";
import { broadcastAgentTabState, cancelAgentTask, claimAgentTab, continueAgentTaskInBackground, focusOrRestoreAgentTab, getAgentTabState, getAgentTaskForId, getAgentTaskTab, markAgentTaskWaitingForInput, moveAgentTaskToTab, pauseAgentTaskForTab, releaseAgentTab, resumeAgentTask, resumeAgentTaskAfterInput, startAgentTask, endAgentTask } from "./agent-tab";
import { ATTENTION_SOUND_STORAGE_KEY, loadAttentionRequests, removeAttentionForSession as removeStoredAttentionForSession, removeAttentionRequest, saveAttentionRequest, setAttentionFocus, type AttentionRequest, type HumanApprovalRequest } from "../../shared/attention";
import { DOCUMENT_LIMITS, IMAGE_MEDIA_TYPES, type UserQuestion } from "../../shared/protocol";

const bridge = new ExtensionBridge();
const ATTENTION_NOTIFICATION_PREFIX = "dsh-attention-";
const activeChatContexts = new Map<string, { sessionId: string; tabId: number }>();
bridge.setChatDeltaHandler((delta) => {
  void chrome.runtime.sendMessage({ type: "dsh-chat-delta", delta }).catch(() => undefined);
});
bridge.setChatProgressHandler((progress) => {
  void chrome.runtime.sendMessage({ type: "dsh-chat-progress", progress }).catch(() => undefined);
});
bridge.setEventHandler((event, payload) => {
  if (event === "human_approval_requested") void handleAttentionEvent("human_approval", payload);
  else if (event === "user_question_requested") void handleAttentionEvent("user_question", payload);
});
bridge.setRequestHandler(async (request) => {
  const taskTab = request.taskId ? await getAgentTaskTab(request.taskId) : undefined;
  if (request.method === "snapshot") return await captureBrowserSnapshot(taskTab);
  if (request.method === "wait") {
    const timeoutMs = (request.params as { timeoutMs?: unknown })?.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000) {
      throw new Error("Wait timeout must be an integer from 250 to 10,000 milliseconds.");
    }
    return await waitForBrowserSettled(timeoutMs, taskTab);
  }
  if (request.method === "screenshot") return await captureBrowserScreenshot(taskTab);
  if (request.method === "scroll") {
    const params = request.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Scroll parameters are required.");
    const direction = (params as { direction?: unknown }).direction;
    const value = (params as { value?: unknown }).value;
    if (!["up", "down", "left", "right"].includes(direction as string)) throw new Error("Scroll direction must be up, down, left, or right.");
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error("Scroll value must be an integer from 1 to 1,000,000 pixels.");
    return await scrollBrowser(direction as "up" | "down" | "left" | "right", value, taskTab);
  }
  if (request.method === "click") {
    const ref = (request.params as { ref?: unknown })?.ref;
    if (!Number.isInteger(ref) || (ref as number) < 1) throw new Error("Browser ref must be a positive integer.");
    return await clickBrowserRef(ref as number, taskTab);
  }
  if (request.method === "type") {
    const ref = (request.params as { ref?: unknown })?.ref;
    const text = (request.params as { text?: unknown })?.text;
    if (!Number.isInteger(ref) || (ref as number) < 1 || typeof text !== "string") throw new Error("Browser type requires a positive ref and text.");
    return await typeBrowserRef(ref as number, text, taskTab);
  }
  if (request.method === "navigate") {
    const url = (request.params as { url?: unknown })?.url;
    if (typeof url !== "string") throw new Error("Browser navigate requires a URL.");
    const parsed = parseHttpUrl(url);
    const result = await navigateBrowser(parsed.href, taskTab);
    await broadcastAgentTabState();
    return result;
  }
  if (request.method === "tabs") return await listBrowserTabs();
  throw new Error(`Unsupported browser method: ${request.method}`);
});

// MV3 workers can be reloaded without firing onInstalled or onStartup.
// Starting here ensures opening the side panel always reconnects the bridge.
void bridge.start();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void bridge.start();
});

chrome.runtime.onStartup.addListener(() => void bridge.start());
let lastActiveTabId: number | undefined;
void initializeLastActiveTab();
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const previousTabId = lastActiveTabId;
  lastActiveTabId = tabId;
  void handleTabActivated(tabId, previousTabId);
});
chrome.tabs.onRemoved.addListener((tabId) => void handleTabRemoved(tabId));
chrome.windows.onFocusChanged.addListener((windowId) => void handleWindowFocusChanged(windowId));
chrome.notifications.onClicked.addListener((notificationId) => void openAttentionNotification(notificationId));
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) void openAttentionNotification(notificationId);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  if (message.type === "dsh-bridge-status") { sendResponse({ status: bridge.getStatus() }); return; }
  if (message.type === "dsh-agent-tab-state-request") {
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    void getAgentTabState(sessionId)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Agent tab state is unavailable." }));
    return true;
  }
  if (message.type === "dsh-attention-state-request") {
    void loadAttentionRequests().then((attention) => sendResponse({ ok: true, attention })).catch(() => sendResponse({ ok: true, attention: [] }));
    return true;
  }
  if (message.type === "dsh-agent-switch-tab") {
    const id = (message as { id?: unknown }).id;
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    if (!Number.isInteger(id) || (id as number) < 0) { sendResponse({ ok: false, error: "Browser tab ID must be a non-negative integer." }); return; }
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    void switchAgentToCurrentTab(sessionId, id as number)
      .then((displacedSessionIds) => sendResponse({ ok: true, displacedSessionIds }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The agent tab could not be changed." }));
    return true;
  }
  if (message.type === "dsh-agent-resume-task") {
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    void resumeAgentTask(sessionId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The browser task could not be resumed." }));
    return true;
  }
  if (message.type === "dsh-agent-continue-background") {
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    void continueAgentTaskInBackground(sessionId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The browser task could not continue in the background." }));
    return true;
  }
  if (message.type === "dsh-agent-pause-chat" || message.type === "dsh-agent-discard-chat") {
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    void pauseOrDiscardChat(sessionId, message.type === "dsh-agent-discard-chat")
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The chat could not be stopped." }));
    return true;
  }
  if (message.type === "dsh-agent-claim-tab") {
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    void claimCurrentAgentTab(sessionId)
      .then(({ tab, displacedSessionIds }) => sendResponse({ ok: true, tab: { id: tab.id, title: tab.title, url: tab.url }, displacedSessionIds }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The tab could not be assigned." }));
    return true;
  }
  if (message.type === "dsh-agent-focus-chat") {
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    const url = (message as { url?: unknown }).url;
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    if (url !== undefined && typeof url !== "string") { sendResponse({ ok: false, error: "Saved website is invalid." }); return; }
    void focusOrRestoreAgentTab(sessionId, url)
      .then((tab) => sendResponse({ ok: true, tab: { id: tab.id, title: tab.title, url: tab.url } }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The saved chat tab could not be opened." }));
    return true;
  }
  if (message.type === "dsh-browser-snapshot") {
    void captureBrowserSnapshot()
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Snapshot failed." }));
    return true;
  }
  if (message.type === "dsh-browser-click") {
    const ref = (message as { ref?: unknown }).ref;
    if (!Number.isInteger(ref) || (ref as number) < 1) { sendResponse({ ok: false, error: "Browser ref must be a positive integer." }); return; }
    void clickBrowserRef(ref as number)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Click failed." }));
    return true;
  }
  if (message.type === "dsh-browser-type") {
    const ref = (message as { ref?: unknown }).ref;
    const text = (message as { text?: unknown }).text;
    if (!Number.isInteger(ref) || (ref as number) < 1 || typeof text !== "string") { sendResponse({ ok: false, error: "Browser type requires a positive ref and text." }); return; }
    void typeBrowserRef(ref as number, text)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Type failed." }));
    return true;
  }
  if (message.type === "dsh-chat") {
    const text = (message as { text?: unknown }).text;
    const id = (message as { id?: unknown }).id;
    const sessionId = (message as { sessionId?: unknown }).sessionId;
    const resume = (message as { resume?: unknown }).resume;
    const deniedTools = (message as { deniedTools?: unknown }).deniedTools;
    const humanInTheLoop = (message as { humanInTheLoop?: unknown }).humanInTheLoop;
    const content = (message as { content?: unknown }).content;
    const hasAttachmentContent = Array.isArray(content) && content.some((part) => typeof part === "object" && part !== null && "type" in part && ((part as { type?: unknown }).type === "image" || (part as { type?: unknown }).type === "document"));
    if (typeof text !== "string" || (!text.trim() && !hasAttachmentContent)) { sendResponse({ ok: false, error: "Message is empty." }); return; }
    if (typeof id !== "string" || !id) { sendResponse({ ok: false, error: "Chat request ID is invalid." }); return; }
    if (typeof sessionId !== "string" || !sessionId) { sendResponse({ ok: false, error: "Chat session ID is invalid." }); return; }
    if (typeof resume !== "boolean") { sendResponse({ ok: false, error: "Chat resume state is invalid." }); return; }
    if (deniedTools !== undefined && !(Array.isArray(deniedTools) && deniedTools.every((tool) => typeof tool === "string"))) { sendResponse({ ok: false, error: "Tool restrictions are invalid." }); return; }
    if (humanInTheLoop !== undefined && typeof humanInTheLoop !== "boolean") { sendResponse({ ok: false, error: "Human-in-the-loop setting is invalid." }); return; }
    if (content !== undefined && (!Array.isArray(content) || content.length === 0 || content.some((part) => !isBridgePromptContentPart(part)))) {
      sendResponse({ ok: false, error: "Attachments are invalid." }); return;
    }
    void claimCurrentAgentTab(sessionId)
      .then(async ({ tab, displacedSessionIds }) => {
        if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
        await startAgentTask(id, sessionId, tab.id);
        activeChatContexts.set(id, { sessionId, tabId: tab.id });
        try {
          const replyText = await bridge.chat(id, text.trim(), sessionId, resume, deniedTools as string[] | undefined, humanInTheLoop as boolean | undefined, content as Parameters<ExtensionBridge["chat"]>[6]);
          return { text: replyText, displacedSessionIds };
        } finally {
          activeChatContexts.delete(id);
          await clearAttentionForChat(id);
          await endAgentTask(id);
        }
      })
      .then(({ text, displacedSessionIds }) => sendResponse({ ok: true, text, displacedSessionIds }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "DSH chat failed." }));
    return true;
  }
  if (message.type === "dsh-task-draft") {
    const sourceSessionId = (message as { sourceSessionId?: unknown }).sourceSessionId;
    const conversation = (message as { conversation?: unknown }).conversation;
    const currentUrl = (message as { currentUrl?: unknown }).currentUrl;
    const answers = (message as { answers?: unknown }).answers;
    if (typeof sourceSessionId !== "string" || !sourceSessionId || typeof conversation !== "string" || !conversation.trim() || (currentUrl !== undefined && typeof currentUrl !== "string") || (answers !== undefined && (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.values(answers as Record<string, unknown>).some((answer) => typeof answer !== "string")))) {
      sendResponse({ ok: false, error: "Task setup input is invalid." }); return;
    }
    void bridge.taskDraft({ sourceSessionId, conversation, ...(currentUrl ? { currentUrl } : {}), ...(answers ? { answers: answers as Record<string, string> } : {}) })
      .then((draft) => sendResponse({ ok: true, draft }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Task setup failed." }));
    return true;
  }
  if (message.type === "dsh-human-approval-response") {
    const approvalId = (message as { approvalId?: unknown }).approvalId;
    const approved = (message as { approved?: unknown }).approved;
    if (typeof approvalId !== "string" || !approvalId || typeof approved !== "boolean") {
      sendResponse({ ok: false, error: "Human approval response is invalid." });
      return;
    }
    bridge.sendEvent("human_approval_response", { approvalId, approved });
    void resolveAttention("human_approval", approvalId);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "dsh-user-question-response") {
    const questionId = (message as { questionId?: unknown }).questionId;
    const chatId = (message as { chatId?: unknown }).chatId;
    const answer = (message as { answer?: unknown }).answer;
    const cancelled = (message as { cancelled?: unknown }).cancelled;
    const validAnswer = typeof answer === "string" && answer.trim().length > 0;
    const validCancellation = cancelled === true && answer === undefined;
    if (typeof questionId !== "string" || !questionId || typeof chatId !== "string" || !chatId || (!validAnswer && !validCancellation)) {
      sendResponse({ ok: false, error: "User question response is invalid." });
      return;
    }
    bridge.sendEvent("user_question_response", {
      questionId,
      chatId,
      ...(validCancellation ? { cancelled: true } : { answer: (answer as string).trim() }),
    });
    void resolveAttention("user_question", questionId, chatId);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "dsh-new-session") {
    const sessionId = (message as { sessionId?: string }).sessionId ?? "";
    void bridge.newSession()
      .then(() => clearAttentionForSession(sessionId))
      .then(() => releaseAgentTab(sessionId))
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "New session failed." }));
    return true;
  }
  if (message.type === "dsh-bridge-configure") {
    const config = (message as { config?: unknown }).config;
    if (!isBridgeConfiguration(config)) { sendResponse({ ok: false, error: "Invalid bridge configuration." }); return; }
    void bridge.configure(config)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Invalid bridge configuration." }));
    return true;
  }
});

async function initializeLastActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (lastActiveTabId === undefined) lastActiveTabId = tab?.id;
}

async function handleAttentionEvent(kind: AttentionRequest["kind"], payload: unknown): Promise<void> {
  const chatId = isRecord(payload) && typeof payload.chatId === "string" ? payload.chatId : undefined;
  const activeContext = chatId ? activeChatContexts.get(chatId) : undefined;
  const storedTask = !activeContext && chatId ? await getAgentTaskForId(chatId) : undefined;
  const context = activeContext ?? (storedTask ? { sessionId: storedTask.sessionId, tabId: storedTask.tabId } : undefined);
  if (!chatId || !context) {
    if (kind === "human_approval") void chrome.runtime.sendMessage({ type: "dsh-human-approval-request", approval: payload }).catch(() => undefined);
    else void chrome.runtime.sendMessage({ type: "dsh-user-question-request", question: payload }).catch(() => undefined);
    return;
  }

  const requestId = kind === "human_approval"
    ? isHumanApprovalRequest(payload) ? payload.approvalId : undefined
    : isUserQuestionRequest(payload) ? payload.questionId : undefined;
  if (!requestId) return;
  const tab = await chrome.tabs.get(context.tabId).catch(() => undefined);
  const attention: AttentionRequest = {
    id: `${kind}:${requestId}`,
    sessionId: context.sessionId,
    chatId,
    tabId: context.tabId,
    ...(tab?.title ? { tabTitle: tab.title } : {}),
    ...(tab?.url ? { tabUrl: tab.url } : {}),
    kind,
    ...(kind === "human_approval" ? { approval: payload as HumanApprovalRequest } : { question: payload as UserQuestion }),
  };
  const isNewAttention = await saveAttentionRequest(attention);
  await markAgentTaskWaitingForInput(chatId, attention.id);
  await chrome.runtime.sendMessage({ type: "dsh-attention-request", attention }).catch(() => undefined);

  const state = await getAgentTabState(context.sessionId);
  if (isNewAttention && state.task?.runMode === "background") await showAttentionNotification(attention);
}

async function showAttentionNotification(attention: AttentionRequest): Promise<void> {
  const label = attention.tabTitle?.trim() || hostnameFromUrl(attention.tabUrl) || "Agent session";
  const soundEnabled = await attentionSoundEnabled();
  await createAttentionNotification(notificationIdFor(attention.id), {
    type: "basic",
    iconUrl: "icons/deepseek-mark.png",
    title: `${label} needs your input`,
    message: "The agent is waiting for your response.",
    buttons: [{ title: "Open session" }],
    requireInteraction: true,
    silent: !soundEnabled,
  });
}

async function attentionSoundEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get(ATTENTION_SOUND_STORAGE_KEY);
  return result[ATTENTION_SOUND_STORAGE_KEY] !== false;
}

async function openAttentionNotification(notificationId: string): Promise<void> {
  const attentionId = attentionIdFromNotification(notificationId);
  if (!attentionId) return;
  const attention = (await loadAttentionRequests()).find((request) => request.id === attentionId);
  if (!attention) {
    await clearAttentionNotification(notificationId);
    return;
  }
  await setAttentionFocus(attention.sessionId);
  const tab = await focusOrRestoreAgentTab(attention.sessionId, attention.tabUrl).catch(() => undefined);
  if (tab?.id !== undefined) await chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  await chrome.runtime.sendMessage({ type: "dsh-attention-open", sessionId: attention.sessionId }).catch(() => undefined);
  await clearAttentionNotification(notificationId);
}

async function resolveAttention(kind: AttentionRequest["kind"], requestId: string, chatId?: string): Promise<void> {
  const attention = (await loadAttentionRequests()).find((request) =>
    request.kind === kind && request.id === `${kind}:${requestId}` && (chatId === undefined || request.chatId === chatId));
  if (!attention) return;
  await removeAttentionRequest(attention.id);
  await clearAttentionNotification(notificationIdFor(attention.id));
  await resumeAgentTaskAfterInput(attention.sessionId, attention.id);
  await chrome.runtime.sendMessage({ type: "dsh-attention-cleared", attentionId: attention.id, sessionId: attention.sessionId }).catch(() => undefined);
}

async function clearAttentionForChat(chatId: string): Promise<void> {
  const attention = (await loadAttentionRequests()).filter((request) => request.chatId === chatId);
  for (const request of attention) {
    await removeAttentionRequest(request.id);
    await clearAttentionNotification(notificationIdFor(request.id));
  }
}

async function clearAttentionForSession(sessionId: string): Promise<void> {
  const removed = await removeStoredAttentionForSession(sessionId);
  await Promise.all(removed.map((request) => clearAttentionNotification(notificationIdFor(request.id))));
}

async function handleTabRemoved(tabId: number): Promise<void> {
  const attention = (await loadAttentionRequests()).filter((request) => request.tabId === tabId);
  for (const request of attention) {
    await removeAttentionRequest(request.id);
    await clearAttentionNotification(notificationIdFor(request.id));
  }
  await broadcastAgentTabState();
}

function notificationIdFor(attentionId: string): string {
  return `${ATTENTION_NOTIFICATION_PREFIX}${encodeURIComponent(attentionId)}`;
}

function createAttentionNotification(notificationId: string, options: chrome.notifications.NotificationOptions<true>): Promise<void> {
  return new Promise((resolve) => {
    chrome.notifications.create(notificationId, options, () => resolve());
  });
}

function clearAttentionNotification(notificationId: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.notifications.clear(notificationId, () => resolve());
  });
}

function attentionIdFromNotification(notificationId: string): string | undefined {
  if (!notificationId.startsWith(ATTENTION_NOTIFICATION_PREFIX)) return undefined;
  try { return decodeURIComponent(notificationId.slice(ATTENTION_NOTIFICATION_PREFIX.length)); }
  catch { return undefined; }
}

function hostnameFromUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try { return new URL(value).hostname; } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHumanApprovalRequest(value: unknown): value is HumanApprovalRequest {
  if (!isRecord(value)) return false;
  return typeof value.approvalId === "string" && typeof value.chatId === "string" &&
    (value.tool === "browser_click" || value.tool === "browser_navigate" || value.tool === "browser_type") &&
    typeof value.detail === "string";
}

function isUserQuestionRequest(value: unknown): value is UserQuestion {
  if (!isRecord(value)) return false;
  return typeof value.questionId === "string" && value.questionId.length > 0 &&
    typeof value.chatId === "string" && value.chatId.length > 0 &&
    typeof value.question === "string" && value.question.trim().length > 0 &&
    Array.isArray(value.options) && value.options.every((option) => typeof option === "string") &&
    typeof value.allowFreeText === "boolean";
}

async function handleTabActivated(tabId: number, previousTabId?: number): Promise<void> {
  if (previousTabId !== undefined && previousTabId !== tabId) {
    await pauseAgentTaskForTab(tabId, previousTabId);
  }
  await broadcastAgentTabState(undefined, tabId);
}

async function handleWindowFocusChanged(windowId: number): Promise<void> {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await broadcastAgentTabState();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) {
    await broadcastAgentTabState();
    return;
  }
  const previousTabId = lastActiveTabId;
  lastActiveTabId = tab.id;
  await handleTabActivated(tab.id, previousTabId);
}

async function claimCurrentAgentTab(sessionId: string) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("No active browser tab is available.");
  const claim = await claimAgentTab(sessionId, tab);
  await stopDisplacedTasks(claim.displacedSessionIds);
  return claim;
}

async function switchAgentToCurrentTab(sessionId: string, id: number): Promise<string[]> {
  const tab = await chrome.tabs.get(id).catch(() => undefined);
  if (!tab) throw new Error(`No browser tab exists with ID ${id}.`);
  const { displacedSessionIds } = await claimAgentTab(sessionId, tab);
  await stopDisplacedTasks(displacedSessionIds);
  await moveAgentTaskToTab(sessionId, id);
  return displacedSessionIds;
}

async function stopDisplacedTasks(sessionIds: string[]): Promise<void> {
  await Promise.all(sessionIds.map(async (sessionId) => {
    await clearAttentionForSession(sessionId);
    const taskId = await cancelAgentTask(sessionId);
    if (taskId) bridge.sendEvent("cancel_task", { id: taskId });
  }));
}

async function pauseOrDiscardChat(sessionId: string, discard: boolean): Promise<void> {
  await clearAttentionForSession(sessionId);
  const cancelledTaskId = await cancelAgentTask(sessionId);
  if (cancelledTaskId) bridge.sendEvent("cancel_task", { id: cancelledTaskId });
  if (discard) await releaseAgentTab(sessionId);
}

function isBridgeConfiguration(value: unknown): value is BridgeConfiguration {
  return typeof value === "object" && value !== null &&
    "url" in value && typeof value.url === "string" &&
    "token" in value && typeof value.token === "string";
}

function isBridgePromptContentPart(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("type" in value)) return false;
  const part = value as { type?: unknown; text?: unknown; mediaType?: unknown; data?: unknown; name?: unknown };
  if (part.type === "text") return typeof part.text === "string";
  if (part.type === "image") return (IMAGE_MEDIA_TYPES as readonly string[]).includes(part.mediaType as string) &&
    typeof part.data === "string" && (part.name === undefined || typeof part.name === "string");
  return part.type === "document" && typeof part.name === "string" && part.name.length > 0 && part.name.length <= DOCUMENT_LIMITS.maxNameLength &&
    typeof part.data === "string" && isBase64(part.data) && (part.mediaType === undefined || typeof part.mediaType === "string");
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Browser navigate requires an absolute HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser navigate supports only HTTP and HTTPS URLs.");
  }
  return url;
}

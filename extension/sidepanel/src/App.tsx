import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { BridgeChatProgress } from "../../../shared/protocol";

type Message = { kind: "message"; id: string; role: "assistant" | "user"; text: string };
type ToolActivity = { callId: string; tool: string; input?: string; output?: string; status: "running" | "success" | "error"; error?: string };
type ActivityGroup = { kind: "activity"; id: string; steps: ToolActivity[] };
type ConversationItem = Message | ActivityGroup;
type TabSummary = { id?: number; title?: string; url?: string; windowId?: number };
type AgentTabState = { agentTabId?: number; agentTab?: TabSummary; currentTab?: TabSummary };

function App() {
  const [messages, setMessages] = useState<ConversationItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [sessionNotice, setSessionNotice] = useState("");
  const [agentTabState, setAgentTabState] = useState<AgentTabState>({});
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [dismissedTabId, setDismissedTabId] = useState<number>();
  const activeChatIds = useRef(new Set<string>());
  const sessionResetPending = useRef(false);
  const currentTabId = useRef<number | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

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
    chrome.runtime.sendMessage({ type: "dsh-bridge-status" }, (response) => {
      if (!chrome.runtime.lastError) setConnectionStatus(response?.status === "connected" ? "connected" : response?.status ?? "disconnected");
    });
    chrome.runtime.sendMessage({ type: "dsh-agent-tab-state-request" }, (response) => {
      if (!chrome.runtime.lastError && response?.ok && response.state) {
        currentTabId.current = response.state.currentTab?.id;
        setAgentTabState(response.state);
      }
    });
    const onMessage = (message: { type?: string; status?: string; progress?: BridgeChatProgress; state?: AgentTabState }) => {
      if (message.type === "dsh-bridge-status" && message.status) {
        setConnectionStatus(message.status);
      } else if (message.type === "dsh-chat-progress" && message.progress && activeChatIds.current.has(message.progress.id)) {
        addToolProgress(message.progress);
      } else if (message.type === "dsh-agent-tab-state" && message.state) {
        if (message.state.currentTab?.id !== currentTabId.current) setDismissedTabId(undefined);
        currentTabId.current = message.state.currentTab?.id;
        setAgentTabState(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const suggestedTab = agentTabState.agentTabId !== undefined &&
    agentTabState.currentTab?.id !== undefined &&
    agentTabState.agentTabId !== agentTabState.currentTab.id &&
    dismissedTabId !== agentTabState.currentTab.id
    ? agentTabState.currentTab
    : undefined;

  function addToolProgress(progress: BridgeChatProgress) {
    setMessages((currentMessages) => {
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
    });
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
    setIsLoading(true);
    let userMessageAdded = false;
    try {
      if (sessionResetPending.current) {
        const sessionResponse = await chrome.runtime.sendMessage({ type: "dsh-new-session" }) as { ok?: boolean; error?: string };
        if (!sessionResponse?.ok) throw new Error(sessionResponse?.error ?? "The new session could not be started.");
        sessionResetPending.current = false;
      }
      activeChatIds.current.add(id);
      setMessages((currentMessages) => [...currentMessages, { kind: "message", id: crypto.randomUUID(), role: "user", text }]);
      userMessageAdded = true;
      setPrompt("");
      setSessionNotice("");
      const response = await chrome.runtime.sendMessage({ type: "dsh-chat", id, text }) as { ok?: boolean; text?: string; error?: string };
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: response?.ok && response.text ? response.text : `I couldn't complete that request: ${response?.error ?? "The DSH bridge is unavailable."}`,
      }]);
    } catch (error) {
      if (!userMessageAdded && sessionResetPending.current) {
        setSessionNotice("New chat is ready. It will start when DSH reconnects.");
        return;
      }
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: error instanceof Error ? error.message : "The snapshot bridge is unavailable.",
      }]);
    } finally {
      activeChatIds.current.delete(id);
      setIsLoading(false);
    }
  }

  async function startNewSession() {
    if (isLoading || isStartingSession) return;
    sessionResetPending.current = true;
    setMessages([]);
    setPrompt("");
    setSessionNotice("");
    textareaRef.current?.focus();

    if (connectionStatus !== "connected") {
      setSessionNotice("New chat is ready. It will start when DSH reconnects.");
      return;
    }

    setIsStartingSession(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-new-session" }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The new session could not be started.");
      sessionResetPending.current = false;
    } catch (error) {
      setSessionNotice("New chat is ready. It will start when DSH reconnects.");
    } finally {
      setIsStartingSession(false);
    }
  }

  async function moveAgentToCurrentTab() {
    if (suggestedTab?.id === undefined || isSwitchingTab) return;
    setIsSwitchingTab(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-agent-switch-tab", id: suggestedTab.id }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The agent tab could not be changed.");
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
        <button className="new-chat-button" type="button" onClick={() => void startNewSession()} disabled={isLoading || isStartingSession}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.25a.75.75 0 0 1 .75.75v5.25H14a.75.75 0 0 1 0 1.5H8.75V14a.75.75 0 0 1-1.5 0V8.75H2a.75.75 0 0 1 0-1.5h5.25V2A.75.75 0 0 1 8 1.25Z" />
          </svg>
          {isStartingSession ? "Starting..." : "New chat"}
        </button>
      </header>

      {agentTabState.agentTabId !== undefined && (
        <section className="agent-tab-status" aria-label="Agent tab">
          <span className="agent-tab-dot" aria-hidden="true" />
          <span><strong>Agent tab</strong>{agentTabState.agentTab ? tabLabel(agentTabState.agentTab) : "Closed"}</span>
        </section>
      )}

      {suggestedTab && (
        <section className="tab-switch-prompt" role="dialog" aria-label="Switch agent tab">
          <div>
            <strong>Switch agent to {tabLabel(suggestedTab)}?</strong>
            <p>{agentTabState.agentTab ? `The agent is still working on ${tabLabel(agentTabState.agentTab)}.` : "The assigned tab was closed."}</p>
          </div>
          <div className="tab-switch-actions">
            <button type="button" onClick={() => setDismissedTabId(suggestedTab.id)}>Keep current task</button>
            <button className="tab-switch-primary" type="button" onClick={() => void moveAgentToCurrentTab()} disabled={isSwitchingTab}>
              {isSwitchingTab ? "Switching..." : "Switch agent here"}
            </button>
          </div>
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
                <p>{message.text}</p>
              </div>
            </article>
          ) : (
            <section className="tool-activity" key={message.id} aria-label="Browser activity">
              {message.steps.map((step) => (
                <details className={`tool-step tool-step-${step.status}`} key={step.callId}>
                  <summary>
                    <span className="tool-status" aria-label={step.status} />
                    <span className="tool-name">{toolLabel(step.tool)}</span>
                    <span className="tool-result">{statusLabel(step.status)}</span>
                  </summary>
                  <dl className="tool-io">
                    <div><dt>Input</dt><dd>{step.input ?? "No input"}</dd></div>
                    <div><dt>Output</dt><dd>{step.error ?? step.output ?? "Working"}</dd></div>
                  </dl>
                </details>
              ))}
            </section>
          ))}
        </div>
      </section>

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

function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    browser_snapshot: "Reading page", browser_wait: "Waiting for page", browser_screenshot: "Capturing screenshot", browser_scroll: "Scrolling page", browser_click: "Clicking element", browser_type: "Entering text", browser_navigate: "Opening page", browser_tabs: "Listing tabs", browser_switch_tab: "Switching tab",
  };
  return labels[tool] ?? "Using tool";
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

export default App;

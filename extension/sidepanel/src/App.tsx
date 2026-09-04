import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { BridgeChatProgress } from "../../../shared/protocol";

type Message = { kind: "message"; id: string; role: "assistant" | "user"; text: string };
type ToolActivity = { callId: string; tool: string; detail?: string; status: "running" | "success" | "error"; error?: string };
type ActivityGroup = { kind: "activity"; id: string; steps: ToolActivity[] };
type ConversationItem = Message | ActivityGroup;

function App() {
  const [messages, setMessages] = useState<ConversationItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const activeChatIds = useRef(new Set<string>());
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
    const onMessage = (message: { type?: string; status?: string; progress?: BridgeChatProgress }) => {
      if (message.type === "dsh-bridge-status" && message.status) {
        setConnectionStatus(message.status);
      } else if (message.type === "dsh-chat-progress" && message.progress && activeChatIds.current.has(message.progress.id)) {
        addToolProgress(message.progress);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  function addToolProgress(progress: BridgeChatProgress) {
    setMessages((currentMessages) => {
      const groupIndex = currentMessages.findIndex((item) => item.kind === "activity" && item.id === progress.id);
      const step: ToolActivity = {
        callId: progress.callId,
        tool: progress.tool,
        ...(progress.detail ? { detail: progress.detail } : {}),
        status: progress.phase === "tool_started" ? "running" : progress.phase === "tool_finished" ? "success" : "error",
        ...(progress.error ? { error: progress.error } : {}),
      };
      if (groupIndex === -1) return [...currentMessages, { kind: "activity", id: progress.id, steps: [step] }];

      const group = currentMessages[groupIndex] as ActivityGroup;
      const existingIndex = group.steps.findIndex((candidate) => candidate.callId === progress.callId);
      const steps = existingIndex === -1
        ? [...group.steps, step]
        : group.steps.map((candidate, index) => index === existingIndex ? { ...candidate, ...step, detail: step.detail ?? candidate.detail } : candidate);
      return currentMessages.map((item, index) => index === groupIndex ? { ...group, steps } : item);
    });
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    const id = crypto.randomUUID();
    activeChatIds.current.add(id);
    setMessages((currentMessages) => [...currentMessages, { kind: "message", id: crypto.randomUUID(), role: "user", text }]);
    setPrompt("");
    setIsLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-chat", id, text }) as { ok?: boolean; text?: string; error?: string };
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: response?.ok && response.text ? response.text : `I couldn't complete that request: ${response?.error ?? "The DSH bridge is unavailable."}`,
      }]);
    } catch (error) {
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
    setIsStartingSession(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-new-session" }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "The new session could not be started.");
      setMessages([]);
      setPrompt("");
      textareaRef.current?.focus();
    } catch (error) {
      setMessages((currentMessages) => [...currentMessages, {
        kind: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: error instanceof Error ? error.message : "The new session could not be started.",
      }]);
    } finally {
      setIsStartingSession(false);
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

      <section className="conversation" aria-label="Current chat">
        <div className="conversation-heading"><span>Current chat</span><span className="conversation-date">Today</span></div>
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
                <div className={`tool-step tool-step-${step.status}`} key={step.callId}>
                  <span className="tool-status" aria-label={step.status} />
                  <span className="tool-name">{toolLabel(step.tool)}</span>
                  <span className="tool-detail">{step.error ?? step.detail ?? statusLabel(step.status)}</span>
                  <span className="tool-result">{statusLabel(step.status)}</span>
                </div>
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
          <button className="send-button" type="submit" aria-label="Send message" disabled={isLoading}>
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

export default App;

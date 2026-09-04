import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

const initialMessage: Message = {
  id: 1,
  role: "assistant",
  text: "Ready when you are. Browser actions will appear here.",
};

function App() {
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [prompt, setPrompt] = useState("");
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

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();

    if (!text) {
      return;
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      { id: Date.now(), role: "user", text },
    ]);
    setPrompt("");
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
          UI preview
        </span>
      </header>

      <section className="conversation" aria-label="Current chat">
        <div className="conversation-heading">
          <span>Current chat</span>
          <span className="conversation-date">Today</span>
        </div>

        <div className="messages" ref={messagesRef} aria-live="polite">
          {messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">
                {message.role === "assistant" ? "D" : "Y"}
              </div>
              <div className="message-content">
                {message.role === "assistant" && (
                  <p className="message-author">DeepSeek Harness</p>
                )}
                <p>{message.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <form className="composer" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="prompt">Message the browser agent</label>
        <textarea
          ref={textareaRef}
          id="prompt"
          name="prompt"
          rows={1}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Ask the browser agent..."
          autoComplete="off"
        />
        <div className="composer-footer">
          <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
          <button className="send-button" type="submit" aria-label="Send message">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M14.7 1.3a.75.75 0 0 0-.78-.17l-12 4.5a.75.75 0 0 0 .05 1.42l5.07 1.69 1.69 5.07a.75.75 0 0 0 1.42.05l4.5-12a.75.75 0 0 0 .05-.56ZM8.3 8.76l-.68-2.04 4.42-2.21-3.74 4.25Zm.47 3.06-1.18-3.55 4.32-4.9-3.14 8.45Z" />
            </svg>
          </button>
        </div>
      </form>
    </main>
  );
}

export default App;

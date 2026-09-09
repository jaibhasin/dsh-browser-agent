import { Fragment } from "react";
import { MarkdownMessage } from "../MarkdownMessage";
import { type StreamingAssistant } from "../assistant-stream";
import { type ConversationItem } from "../chat-history";
import { type DraftImage } from "../image-attachments";

import type * as React from "react";
import { ToolThread } from "./ToolThread";
import { UserMessageContent } from "./UserMessageContent";

type ConversationProps = {
  sessionNotice: string;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  streamingAssistant: StreamingAssistant | undefined;
  activeSessionId: string;
  assistantAfterActivity: React.RefObject<Set<string>>;
  messages: ConversationItem[];
  messageImageDataRef: React.RefObject<Map<string, DraftImage[]>>;
};

export function Conversation({
  sessionNotice,
  messagesRef,
  streamingAssistant,
  activeSessionId,
  assistantAfterActivity,
  messages,
  messageImageDataRef,
}: ConversationProps) {
  return (
    <>
      <section className="conversation" aria-label="Current chat">
        {sessionNotice && <p className="session-notice" role="status">{sessionNotice}</p>}
        <div className="messages" ref={messagesRef} aria-live="polite">
          {(() => {
            const currentStreamingAssistant = streamingAssistant?.sessionId === activeSessionId ? streamingAssistant : undefined;
            // Before the first tool starts, the live assistant segment belongs
            // before the activity group. Once a tool has started, the stream is
            // reset and any new text belongs after that group.
            const activityIndex = currentStreamingAssistant && !assistantAfterActivity.current.has(currentStreamingAssistant.id)
              ? messages.findIndex((item) => item.kind === "activity" && item.id === currentStreamingAssistant.id)
              : -1;
            const streamingMessage = currentStreamingAssistant && (
              <article className="message message-assistant" key={`streaming-${currentStreamingAssistant.id}`}>
                <div className="message-meta">DSH</div>
                <div className="message-content"><MarkdownMessage text={currentStreamingAssistant.text} /></div>
              </article>
            );

            return (
              <>
                {messages.map((message, index) => (
                  <Fragment key={message.id}>
                    {index === activityIndex && streamingMessage}
                    {message.kind === "message" ? (
                      <article className={`message message-${message.role}`}>
                        <div className="message-meta">{message.role === "assistant" ? "DSH" : "You"}</div>
                        <div className="message-content">
                          {message.role === "assistant" ? <MarkdownMessage text={message.text} /> : (
                            <UserMessageContent message={message} images={messageImageDataRef.current.get(message.id)} />
                          )}
                        </div>
                      </article>
                    ) : (
                      <ToolThread message={message} />
                    )}
                  </Fragment>
                ))}
                {activityIndex === -1 && streamingMessage}
              </>
            );
          })()}
        </div>
      </section>
    </>
  );
}

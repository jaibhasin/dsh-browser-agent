import { type SavedChat } from "../chat-history";

import type * as React from "react";

type ChatHistoryProps = {
  isHistoryOpen: boolean;
  startNewSession: () => Promise<void>;
  isStartingSession: boolean;
  savedChats: SavedChat[];
  activeSessionId: string;
  openSavedChat: (chat: SavedChat) => void;
  isSwitchingTab: boolean;
  setPendingDeleteChat: React.Dispatch<React.SetStateAction<SavedChat | undefined>>;
  deletingChatId: string | undefined;
  isLoading: boolean;
};

export function ChatHistory({
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
}: ChatHistoryProps) {
  return (
    <>
      {isHistoryOpen && (
        <section className="chat-history" aria-label="Saved chats">
          <div className="chat-history-header"><strong>Chats</strong><button type="button" onClick={() => void startNewSession()} disabled={isStartingSession}>New chat</button></div>
          {savedChats.length === 0 ? <p className="chat-history-empty">Your completed chats will appear here.</p> : (
            <ul>
              {savedChats.map((chat) => (
                <li key={chat.id} className={chat.id === activeSessionId ? "selected" : undefined}>
                  {/*
                    Chat row layout (kept uniform across all rows):
                    [ chat card (opens chat) ] [ "Open site" link? ] [ delete icon ]
                    The delete button is ALWAYS rendered last so it sits at the
                    same far-right position whether or not a link exists.
                  */}
                  <button
                    type="button"
                    className="chat-open-button"
                    onClick={() => openSavedChat(chat)}
                    disabled={isSwitchingTab}
                  >
                    <span className="chat-history-title">{chat.title}</span>
                    <span className="chat-history-meta">
                      <small className={`chat-status chat-status-${chat.status}`}>{chat.status === "active" ? "Active" : chat.status}</small>
                      <small>{new Date(chat.updatedAt).toLocaleDateString()}</small>
                    </span>
                  </button>
                  {chat.links[0] && <a href={chat.links[0]} target="_blank" rel="noreferrer" title="Open last visited website">Open site</a>}
                  <button
                    className="chat-delete-button"
                    type="button"
                    onClick={() => setPendingDeleteChat(chat)}
                    disabled={deletingChatId !== undefined || (chat.id === activeSessionId && isLoading)}
                    aria-label={`Delete ${chat.title}`}
                    title={chat.id === activeSessionId && isLoading ? "Finish the current chat before deleting it" : "Delete chat"}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5.5 2.25h5l.55 1.5H14v1h-.75v7.5A1.75 1.75 0 0 1 11.5 14h-7a1.75 1.75 0 0 1-1.75-1.75v-7.5H2v-1h2.95l.55-1.5Zm.5 1.5h4l-.27-.75H6.27L6 3.75ZM3.75 4.75v7.5c0 .69.56 1.25 1.25 1.25h7c.69 0 1.25-.56 1.25-1.25v-7.5h-9.5Zm2 1.5h1v5.5h-1v-5.5Zm3.5 0h1v5.5h-1v-5.5Z" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

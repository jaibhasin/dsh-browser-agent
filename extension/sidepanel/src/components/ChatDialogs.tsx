import type { UserQuestion } from "../../../../shared/protocol";
import { type SavedChat } from "../chat-history";

import type * as React from "react";
import type { HumanApprovalRequest } from "../requests";

type ChatDialogsProps = {
  pendingDeleteChat: SavedChat | undefined;
  deletingChatId: string | undefined;
  setPendingDeleteChat: React.Dispatch<React.SetStateAction<SavedChat | undefined>>;
  deleteSavedChat: (chat: SavedChat) => Promise<void>;
  pendingUserQuestion: UserQuestion | undefined;
  respondToUserQuestion: (answer?: string) => void;
  userQuestionText: string;
  setUserQuestionText: React.Dispatch<React.SetStateAction<string>>;
  pendingHumanApproval: HumanApprovalRequest | undefined;
  respondToHumanApproval: (approved: boolean) => void;
};

export function ChatDialogs({
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
}: ChatDialogsProps) {
  return (
    <>
      {pendingDeleteChat && (
        <div className="delete-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !deletingChatId) setPendingDeleteChat(undefined);
        }}>
          <section className="delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-description">
            <div className="delete-modal-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20"><path d="M6.5 3h7l.7 2H17v1.5h-1v8A2.5 2.5 0 0 1 13.5 17h-7A2.5 2.5 0 0 1 4 14.5v-8H3V5h2.8l.7-2Zm1.1 2h5.8l-.35-1H7.95l-.35 1ZM5.5 6.5v8c0 .83.67 1.5 1.5 1.5h7c.83 0 1.5-.67 1.5-1.5v-8h-10Zm2 2h1.5v5.5H7.5V8.5Zm3.5 0h1.5v5.5H11V8.5Z" /></svg>
            </div>
            <div className="delete-modal-copy">
              <span className="delete-modal-eyebrow">Delete chat</span>
              <h2 id="delete-modal-title">Delete this conversation?</h2>
              <p id="delete-modal-description"><strong>{pendingDeleteChat.title}</strong> will be permanently removed from your chat history.</p>
            </div>
            <div className="delete-modal-actions">
              <button type="button" onClick={() => setPendingDeleteChat(undefined)} disabled={Boolean(deletingChatId)}>Cancel</button>
              <button className="delete-modal-danger" type="button" onClick={() => void deleteSavedChat(pendingDeleteChat)} disabled={Boolean(deletingChatId)}>
                {deletingChatId ? "Deleting..." : "Delete chat"}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingUserQuestion && (
        <div className="delete-modal-backdrop" role="presentation">
          <section className="delete-modal user-question-modal" role="dialog" aria-modal="true" aria-labelledby="user-question-title" aria-describedby="user-question-description">
            <div className="delete-modal-icon approval-modal-icon" aria-hidden="true">?</div>
            <div className="delete-modal-copy">
              <span className="delete-modal-eyebrow user-question-eyebrow">The agent needs your input</span>
              <h2 id="user-question-title">{pendingUserQuestion.question}</h2>
              <p id="user-question-description">Choose an answer to let the agent continue.</p>
            </div>
            {pendingUserQuestion.options.length > 0 && (
              <div className="user-question-options" aria-label="Answer choices">
                {pendingUserQuestion.options.map((option) => (
                  <button type="button" key={option} onClick={() => respondToUserQuestion(option)}>{option}</button>
                ))}
              </div>
            )}
            {pendingUserQuestion.allowFreeText && (
              <form className="user-question-form" onSubmit={(event) => {
                event.preventDefault();
                respondToUserQuestion(userQuestionText);
              }}>
                <label htmlFor="user-question-answer">Your answer</label>
                <div className="user-question-input-row">
                  <input
                    id="user-question-answer"
                    value={userQuestionText}
                    onChange={(event) => setUserQuestionText(event.target.value)}
                    placeholder="Type your answer..."
                    autoFocus
                  />
                  <button className="delete-modal-primary" type="submit" disabled={!userQuestionText.trim()}>Send</button>
                </div>
              </form>
            )}
            <div className="delete-modal-actions">
              <button type="button" onClick={() => respondToUserQuestion()}>Cancel</button>
            </div>
          </section>
        </div>
      )}

      {pendingHumanApproval && (
        <div className="delete-modal-backdrop" role="presentation">
          <section className="delete-modal approval-modal" role="alertdialog" aria-modal="true" aria-labelledby="approval-modal-title" aria-describedby="approval-modal-description">
            <div className="delete-modal-icon approval-modal-icon" aria-hidden="true">?</div>
            <div className="delete-modal-copy">
              <span className="delete-modal-eyebrow">Human approval required</span>
              <h2 id="approval-modal-title">Allow {pendingHumanApproval.tool === "browser_click" ? "this click" : pendingHumanApproval.tool === "browser_type" ? "this text entry" : "this navigation"}?</h2>
              <p id="approval-modal-description">The agent wants to {pendingHumanApproval.tool === "browser_click" ? "click" : pendingHumanApproval.tool === "browser_type" ? "type into" : "navigate to"} <strong>{pendingHumanApproval.detail}</strong>.</p>
            </div>
            <div className="delete-modal-actions">
              <button type="button" onClick={() => respondToHumanApproval(false)}>Deny</button>
              <button className="delete-modal-primary" type="button" onClick={() => respondToHumanApproval(true)}>Allow</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

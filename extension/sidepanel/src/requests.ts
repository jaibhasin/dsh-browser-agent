import type { UserQuestion } from "../../../shared/protocol";

export type CurrentTaskAction = "background" | "pause" | "quit";
export type HumanApprovalRequest = { approvalId: string; chatId: string; tool: "browser_click" | "browser_navigate" | "browser_type"; detail: string };
export type UserQuestionRequest = UserQuestion;

export function isHumanApprovalRequest(value: unknown): value is HumanApprovalRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const approval = value as Partial<HumanApprovalRequest>;
  return typeof approval.approvalId === "string" && typeof approval.chatId === "string" &&
    (approval.tool === "browser_click" || approval.tool === "browser_navigate" || approval.tool === "browser_type") && typeof approval.detail === "string";
}

export function isUserQuestionRequest(value: unknown): value is UserQuestionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const question = value as Partial<UserQuestionRequest>;
  return typeof question.questionId === "string" && question.questionId.length > 0 &&
    typeof question.chatId === "string" && question.chatId.length > 0 &&
    typeof question.question === "string" && question.question.trim().length > 0 &&
    Array.isArray(question.options) && question.options.every((option) => typeof option === "string") &&
    typeof question.allowFreeText === "boolean";
}


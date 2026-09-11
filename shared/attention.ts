import type { UserQuestion } from "./protocol";

export const ATTENTION_STORAGE_KEY = "dshAgentAttention";
export const ATTENTION_FOCUS_STORAGE_KEY = "dshAgentAttentionFocus";
export const ATTENTION_SOUND_STORAGE_KEY = "dshAgentAttentionSoundV1";

export type HumanApprovalRequest = {
  approvalId: string;
  chatId: string;
  tool: "browser_click" | "browser_navigate" | "browser_type";
  detail: string;
};

export type AttentionRequest = {
  id: string;
  sessionId: string;
  chatId: string;
  tabId: number;
  tabTitle?: string;
  tabUrl?: string;
  kind: "human_approval" | "user_question";
  approval?: HumanApprovalRequest;
  question?: UserQuestion;
};

type StoredAttention = Record<string, AttentionRequest>;
let attentionMutationQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHumanApproval(value: unknown): value is HumanApprovalRequest {
  if (!isRecord(value)) return false;
  return typeof value.approvalId === "string" && typeof value.chatId === "string" &&
    (value.tool === "browser_click" || value.tool === "browser_navigate" || value.tool === "browser_type") &&
    typeof value.detail === "string";
}

function isUserQuestion(value: unknown): value is UserQuestion {
  if (!isRecord(value)) return false;
  return typeof value.questionId === "string" && value.questionId.length > 0 &&
    typeof value.chatId === "string" && value.chatId.length > 0 &&
    typeof value.question === "string" && value.question.trim().length > 0 &&
    Array.isArray(value.options) && value.options.every((option) => typeof option === "string") &&
    typeof value.allowFreeText === "boolean";
}

export function isAttentionRequest(value: unknown): value is AttentionRequest {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.sessionId !== "string" ||
    typeof value.chatId !== "string" || !Number.isInteger(value.tabId) ||
    (value.tabTitle !== undefined && typeof value.tabTitle !== "string") ||
    (value.tabUrl !== undefined && typeof value.tabUrl !== "string")) return false;
  if (value.kind === "human_approval") {
    return isHumanApproval(value.approval) && value.approval.chatId === value.chatId && value.id === `human_approval:${value.approval.approvalId}` && value.question === undefined;
  }
  if (value.kind === "user_question") {
    return isUserQuestion(value.question) && value.question.chatId === value.chatId && value.id === `user_question:${value.question.questionId}` && value.approval === undefined;
  }
  return false;
}

export async function loadAttentionRequests(): Promise<AttentionRequest[]> {
  const result = await chrome.storage.session.get(ATTENTION_STORAGE_KEY);
  const stored = result[ATTENTION_STORAGE_KEY];
  if (!isRecord(stored)) return [];
  return Object.values(stored).filter(isAttentionRequest);
}

export function saveAttentionRequest(request: AttentionRequest): Promise<boolean> {
  let inserted = false;
  return enqueueAttentionMutation(async () => {
    const requests = await loadAttentionRequests();
    inserted = !requests.some((item) => item.id === request.id);
    const next: StoredAttention = Object.fromEntries(requests.filter((item) => item.id !== request.id).map((item) => [item.id, item]));
    next[request.id] = request;
    await chrome.storage.session.set({ [ATTENTION_STORAGE_KEY]: next });
  }).then(() => inserted);
}

export function removeAttentionRequest(id: string): Promise<AttentionRequest | undefined> {
  let removed: AttentionRequest | undefined;
  return enqueueAttentionMutation(async () => {
    const requests = await loadAttentionRequests();
    removed = requests.find((request) => request.id === id);
    if (!removed) return;
    const next = Object.fromEntries(requests.filter((request) => request.id !== id).map((request) => [request.id, request]));
    await chrome.storage.session.set({ [ATTENTION_STORAGE_KEY]: next });
  }).then(() => removed);
}

export function removeAttentionForSession(sessionId: string): Promise<AttentionRequest[]> {
  let removed: AttentionRequest[] = [];
  return enqueueAttentionMutation(async () => {
    const requests = await loadAttentionRequests();
    removed = requests.filter((request) => request.sessionId === sessionId);
    if (removed.length === 0) return;
    const next = Object.fromEntries(requests.filter((request) => request.sessionId !== sessionId).map((request) => [request.id, request]));
    await chrome.storage.session.set({ [ATTENTION_STORAGE_KEY]: next });
  }).then(() => removed);
}

export async function setAttentionFocus(sessionId: string): Promise<void> {
  await chrome.storage.session.set({ [ATTENTION_FOCUS_STORAGE_KEY]: sessionId });
}

export async function consumeAttentionFocus(): Promise<string | undefined> {
  const result = await chrome.storage.session.get(ATTENTION_FOCUS_STORAGE_KEY);
  const sessionId = result[ATTENTION_FOCUS_STORAGE_KEY];
  await chrome.storage.session.remove(ATTENTION_FOCUS_STORAGE_KEY);
  return typeof sessionId === "string" && sessionId ? sessionId : undefined;
}

function enqueueAttentionMutation(operation: () => Promise<void>): Promise<void> {
  const next = attentionMutationQueue.then(operation);
  attentionMutationQueue = next.catch(() => undefined);
  return next;
}

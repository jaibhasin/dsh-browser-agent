import type { SavedChat } from "../extension/sidepanel/src/chat-history";
import type { BenchmarkTab } from "./benchmark";

export function benchmarkChat(sessionId: string, prompt: string, tab: BenchmarkTab, startedAt: number, text?: string, failed = false): SavedChat {
  return {
    id: sessionId, title: `Memory test: ${tab.title || tab.url || "Page"}`,
    createdAt: startedAt, updatedAt: Date.now(), status: text === undefined ? "active" : failed ? "interrupted" : "completed",
    links: tab.url ? [tab.url] : [],
    items: [{ kind: "message", id: `${sessionId}-prompt`, role: "user", text: prompt },
      ...(text === undefined ? [] : [{ kind: "message" as const, id: `${sessionId}-answer`, role: "assistant" as const, text }])],
  };
}

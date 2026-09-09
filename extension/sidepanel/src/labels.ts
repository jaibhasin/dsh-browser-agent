import type { TabSummary } from "./tab-switch-state";

export function connectionLabel(status: string): string {
  return status === "connected" ? "Live" : status === "disconnected" ? "Offline" : "…";
}

export function tabLabel(tab?: TabSummary): string {
  if (!tab) return "the assigned tab";
  if (tab.title?.trim()) return tab.title.trim();
  if (tab.url) {
    try { return new URL(tab.url).hostname; } catch { return "this tab"; }
  }
  return "this tab";
}


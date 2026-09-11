export type BenchmarkTab = {
  id: number;
  title?: string;
  url?: string;
  windowId: number;
};

export type BenchmarkTaskState = "queued" | "running" | "completed" | "failed";

export type BenchmarkTaskStatus = {
  taskId: string;
  tabId: number;
  title?: string;
  state: BenchmarkTaskState;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

export type BenchmarkRunState = {
  runId: string;
  tabCount: number;
  phase: "running" | "cooldown" | "completed";
  startedAt: number;
  settledAt?: number;
  tasks: BenchmarkTaskStatus[];
};

export type BenchmarkEvent =
  | { type: "extension_ready"; extensionId: string; version: string; timestamp: number }
  | { type: "panel_opened"; tabCount: number; timestamp: number }
  | { type: "run_started"; runId: string; tabCount: number; timestamp: number }
  | { type: "task_started"; runId: string; taskId: string; tabId: number; activeTaskCount: number; timestamp: number }
  | { type: "task_finished"; runId: string; taskId: string; tabId: number; state: "completed" | "failed"; error?: string; activeTaskCount: number; timestamp: number }
  | { type: "run_settled"; runId: string; tabCount: number; timestamp: number };

export type BenchmarkTabsResponse = { ok: true; tabs: BenchmarkTab[] } | { ok: false; error: string };
export type BenchmarkRunResponse = { ok: true; runId: string } | { ok: false; error: string };

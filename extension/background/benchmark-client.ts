import type { BenchmarkEvent } from "../../shared/benchmark";

const BENCHMARK_URL = "http://127.0.0.1:7332/events";

/**
 * The benchmark runner is optional. Failed posts are deliberately ignored so
 * normal extension chats never depend on the measurement command.
 */
export function reportBenchmarkEvent(event: BenchmarkEvent): void {
  void requireBenchmarkEvent(event).catch(() => undefined);
}

export async function requireBenchmarkEvent(event: BenchmarkEvent): Promise<void> {
  try {
    const response = await fetch(BENCHMARK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Recorder rejected this run.");
  } catch {
    throw new Error("Start pnpm benchmark:memory in the terminal before running tasks. Each report needs a new recorder.");
  }
}

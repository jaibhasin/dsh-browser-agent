import type { BenchmarkEvent } from "../../shared/benchmark";

const BENCHMARK_URL = "http://127.0.0.1:7332/events";

/**
 * The benchmark runner is optional. Failed posts are deliberately ignored so
 * normal extension chats never depend on the measurement command.
 */
export function reportBenchmarkEvent(event: BenchmarkEvent): void {
  void fetch(BENCHMARK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

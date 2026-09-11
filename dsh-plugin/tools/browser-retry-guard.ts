import type { BrowserRefMetadata, BrowserSnapshotData } from "../../shared/protocol.js";

const MAX_ATTEMPTS_PER_STATE = 2;
const MAX_ATTEMPTS_PER_TARGET = 4;

export type BrowserMutation =
  | { method: "click"; params: { ref: number } }
  | { method: "navigate"; params: { url: string } }
  | { method: "type"; params: { ref: number; text: string } };

export class BrowserRetryLimitError extends Error {
  readonly code = "BROWSER_RETRY_LIMIT";
  readonly hardStop: boolean;

  constructor(message: string, hardStop: boolean) {
    super(message);
    this.name = "BrowserRetryLimitError";
    this.hardStop = hardStop;
  }
}

type AttemptRecord = {
  count: number;
  stateCounts: Map<string, number>;
  warned: boolean;
};

/** Keeps repeated browser mutations from becoming an unbounded model loop. */
export class BrowserRetryGuard {
  private snapshot?: BrowserSnapshotData;
  private readonly attempts = new Map<string, AttemptRecord>();

  updateSnapshot(snapshot: BrowserSnapshotData): void {
    this.snapshot = snapshot;
  }

  before(mutation: BrowserMutation): void {
    const target = this.targetKey(mutation);
    const state = this.snapshot?.fingerprint ?? this.snapshot?.text ?? "unknown-page-state";
    const record = this.attempts.get(target) ?? { count: 0, stateCounts: new Map(), warned: false };
    const stateCount = record.stateCounts.get(state) ?? 0;

    if (stateCount >= MAX_ATTEMPTS_PER_STATE || record.count >= MAX_ATTEMPTS_PER_TARGET) {
      if (!record.warned) {
        record.warned = true;
        this.attempts.set(target, record);
        throw new BrowserRetryLimitError(
          `This browser action has already been tried ${stateCount} times against the same target and page state. Inspect the page and choose a different observed approach. Repeating this action is paused.`,
          false,
        );
      }
      throw new BrowserRetryLimitError(
        `Retry limit reached for the same browser target after ${record.count} attempts. The task is paused to prevent a loop. Ask the user before taking a risky or uncertain alternative step.`,
        true,
      );
    }

    record.count += 1;
    record.stateCounts.set(state, stateCount + 1);
    this.attempts.set(target, record);
  }

  private targetKey(mutation: BrowserMutation): string {
    if (mutation.method === "navigate") return `navigate|${normaliseUrl(mutation.params.url)}`;
    const ref = mutation.params.ref;
    const metadata = this.snapshot?.refs[String(ref)];
    const target = metadata ? metadataKey(metadata) : this.snapshot ? snapshotRefLine(this.snapshot.text, ref) : `ref:${ref}`;
    if (mutation.method === "type") return `type|${target}|value:${hashText(mutation.params.text)}`;
    return `click|${target}`;
  }
}

function metadataKey(metadata: BrowserRefMetadata): string {
  return [metadata.tag, metadata.role ?? "", metadata.name ?? "", metadata.path].join("|");
}

function snapshotRefLine(text: string, ref: number): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(`[${ref}] `));
  return line ? line.replace(/^\[\d+\] /, "") : `ref:${ref}`;
}

function normaliseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

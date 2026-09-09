import { useState } from "react";
import type { ActivityGroup, ToolActivity } from "../chat-history";

/**
 * Activity spine - the agent's tool-call timeline.
 *
 * Architecture (pairs with the "Tool-activity thread" section of styles.css):
 *
 *   ● Snapshot            1.2s
 *   │
 *   ● Click               0.4s
 *   │
 *   ◉ Type   (pulsing)
 *   │   ┌ Input  "search query" ─┐
 *   │   │ Output  3 results      │
 *   │   └────────────────────────┘
 *   │
 *   ● Scroll              0.3s
 *
 * - The vertical line is NOT one element: every step paints its own 2px
 *   segment (.tool-step::before). Stacked with no gap, the segments read as
 *   one solid spine that starts at the first bead and stops at the last,
 *   even when an input/output card is expanded in the middle.
 * - Each bead is a small dot centered ON the line; its page-colored ring
 *   (box-shadow) masks the line behind it. Bead color = step status:
 *   green = done, pulsing accent = running, red = failed.
 * - Clicking a row slides an Input/Output card open in the gap below it;
 *   the spine keeps running alongside the card, so context never jumps.
 */
export function ToolThread({ message }: { message: ActivityGroup }) {
  return (
    <div className="tool-thread" aria-label="Tool activity">
      {message.steps.map((step) => <ToolStep key={step.callId} step={step} />)}
    </div>
  );
}

/**
 * A single node on the spine.
 *
 * Collapsed: bead + tool name + (once finished) a quiet duration on the right.
 * Expanded:  the same row with an input/output card hanging below it.
 * `useState` mirrors the native <details> open flag so React keeps control.
 */
function ToolStep({ step }: { step: ToolActivity }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      className={`tool-step tool-step-${step.status}`}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary title={`${step.tool} · ${step.status}`}>
        <span className="tool-node" aria-hidden="true" />
        <span className="tool-name">{toolLabel(step.tool)}</span>
        <span className="tool-chevron" aria-hidden="true">›</span>
        {step.durationMs !== undefined && (
          <span className="tool-duration">{formatDuration(step.durationMs)}</span>
        )}
      </summary>
      <dl className="tool-io">
        <div><dt>Input</dt><dd>{step.input ?? "No input"}</dd></div>
        <div><dt>Output</dt><dd>{step.error ?? step.output ?? "Still working…"}</dd></div>
      </dl>
    </details>
  );
}

/**
 * Formats a millisecond duration the way the spine shows it:
 * under a second as "850ms", otherwise one decimal like "1.2s".
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Turns a raw tool id like "browser_snapshot" into a friendly title-case name
 * like "Snapshot" (dropping the "browser_" prefix). Unknown tools simply get
 * their underscores prettified, so new tools always render nicely with no code.
 */
function toolLabel(tool: string): string {
  const words = tool.replace(/^browser_/, "").split("_").filter(Boolean);
  if (words.length === 0) return "Tool";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}


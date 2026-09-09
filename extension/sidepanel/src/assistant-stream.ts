export type StreamingAssistant = { id: string; sessionId: string; text: string };

type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

type StreamCompletion = { id: string; resolve: () => void };

/*
 * ---------------------------------------------------------------------------
 * ChatGPT-style streaming tuning constants
 * ---------------------------------------------------------------------------
 * The rendered text is drained from a buffer in "beats" (one beat = one
 * reveal), instead of the old one-character-per-frame typewriter. Each beat
 * reveals a word-sized chunk, which is what gives ChatGPT its smooth
 * flowing-text look. The drain speed adapts to how far behind we are, so
 * rendering never lags the model no matter how fast deltas arrive.
 * ---------------------------------------------------------------------------
 */
const FRAME_INTERVAL_MS = 16;       // Assumed display-frame duration; used as the reveal window when no rAF timestamp exists (tests, manual schedulers)
const MIN_REVEAL_INTERVAL_MS = 24;  // Throttle: never reveal more often than ~40x/sec so chunks read as steady beats, not flicker
const BASE_CHARS_PER_SECOND = 240;  // Baseline drain rate when the backlog is tiny (calm, readable pace)
const CATCHUP_CHARS_PER_SECOND = 6; // Extra drain speed per buffered character; a large backlog drains faster so we catch up
const MAX_CHARS_PER_SECOND = 4000;  // Upper bound on drain speed; a finished backlog drains in a fast blur, not a single flash
const MAX_WORD_EXTENSION = 8;       // Cap for nudging a cut forward to the next word boundary; long tokens (URLs) cannot stall pacing

// Matches any whitespace code point; chunk cuts are nudged to land right before one.
const WHITESPACE = /\s/u;

/**
 * Finds the end index (exclusive) of one reveal chunk inside `characters`.
 * Starts at `start` and spans roughly `size` characters, then nudges the cut
 * forward to the next word boundary so chunks read as whole words — the
 * visual signature of ChatGPT's stream. Guaranteed to make progress
 * (end > start) so the loop can never stall on a chunk boundary.
 */
function chunkEnd(characters: string[], start: number, size: number): number {
  const total = characters.length;
  const rawEnd = Math.min(start + Math.max(1, size), total);
  if (rawEnd >= total) return total;
  const limit = Math.min(rawEnd + MAX_WORD_EXTENSION, total);
  let end = rawEnd;
  while (end < limit && !WHITESPACE.test(characters[end])) end += 1;
  return end;
}

/**
 * Presents incoming assistant deltas as smooth word-sized chunks.
 * Transport chunks can be large, so the rendered text is deliberately kept
 * separate from the accumulated target text.
 */
export function createAssistantStream(
  onUpdate: (assistant: StreamingAssistant | undefined) => void,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
  cancelFrame: CancelFrame = cancelAnimationFrame,
) {
  let current: StreamingAssistant | undefined;   // what is currently displayed
  let targetText = "";                           // full text received so far
  let frame: number | undefined;
  let completion: StreamCompletion | undefined;
  let lastRevealTime: number | undefined;        // timestamp of the most recent beat
  let fakeClock = 0;                             // advances one frame per tick when no rAF timestamp is supplied (tests)

  function schedule() {
    if (frame !== undefined) return;
    frame = scheduleFrame(animate);
  }

  function animate(timestamp?: number) {
    frame = undefined;
    if (!current) return;

    // requestAnimationFrame supplies a timestamp; manual schedulers (tests) do
    // not, so fall back to a fake clock that advances one frame per tick.
    const now = typeof timestamp === "number" ? timestamp : (fakeClock += FRAME_INTERVAL_MS);

    const targetCharacters = Array.from(targetText);        // split into code points (emoji-safe)
    const renderedCharacters = Array.from(current.text);
    const finishing = completion?.id === current.id;
    if (renderedCharacters.length < targetCharacters.length && (!finishing || targetText.startsWith(current.text))) {
      // Reveal on a steady beat: first frame after idle beats the throttle,
      // otherwise wait for the minimum interval between reveals.
      const elapsedMs = lastRevealTime === undefined ? Number.POSITIVE_INFINITY : now - lastRevealTime;
      if (elapsedMs >= MIN_REVEAL_INTERVAL_MS) {
        const backlog = targetCharacters.length - renderedCharacters.length;
        // Adaptive speed: a small backlog keeps the calm baseline pace, while
        // a large backlog drains faster so rendering never falls behind.
        const charsPerSecond = Math.min(BASE_CHARS_PER_SECOND + backlog * CATCHUP_CHARS_PER_SECOND, MAX_CHARS_PER_SECOND);
        // When the last beat is stale (tab was idle/backgrounded) size the
        // chunk from a single frame window instead of the huge stale gap.
        const revealWindowMs = Number.isFinite(elapsedMs) ? elapsedMs : FRAME_INTERVAL_MS;
        const size = Math.max(1, Math.round((revealWindowMs / 1000) * charsPerSecond));
        const end = chunkEnd(targetCharacters, renderedCharacters.length, size);
        if (end > renderedCharacters.length) {
          // Rendered text is always a prefix of the target, so slicing the
          // target array keeps the reveal consistent and code-point safe.
          current = { ...current, text: targetCharacters.slice(0, end).join("") };
          onUpdate(current);
          lastRevealTime = now;
        }
      }
    } else if (finishing && current.text !== targetText) {
      // The final response is authoritative. A provider can normalize or
      // revise streamed text, so do not leave completion waiting for an
      // impossible chunk-by-chunk match.
      current = { ...current, text: targetText };
      onUpdate(current);
    }

    if (current.text === targetText) {
      // Caught up: reset the reveal clock so the next burst starts on a
      // fresh beat, and resolve any pending finish() promise.
      lastRevealTime = undefined;
      if (completion?.id === current.id) {
        const resolve = completion.resolve;
        completion = undefined;
        resolve();
      }
    } else {
      schedule();
    }
  }

  function append(delta: { id: string; sessionId: string; text: string }) {
    if (!delta.text) return;
    if (current?.id !== delta.id) {
      if (completion) {
        completion.resolve();
        completion = undefined;
      }
      current = { id: delta.id, sessionId: delta.sessionId, text: "" };
      targetText = "";
      lastRevealTime = undefined;
      onUpdate(current);
    }
    targetText += delta.text;
    schedule();
  }

  function finish(id: string, text: string): Promise<void> {
    if (!current || current.id !== id) return Promise.resolve();
    targetText = text;
    if (current.text === targetText) return Promise.resolve();
    return new Promise((resolve) => {
      completion = { id, resolve };
      schedule();
    });
  }

  function clear(id?: string) {
    if (id && current?.id !== id) return;
    if (frame !== undefined) {
      cancelFrame(frame);
      frame = undefined;
    }
    completion?.resolve();
    completion = undefined;
    current = undefined;
    targetText = "";
    lastRevealTime = undefined;
    onUpdate(undefined);
  }

  function getTarget(id: string): string | undefined {
    return current?.id === id ? targetText : undefined;
  }

  return { append, finish, clear, getTarget };
}

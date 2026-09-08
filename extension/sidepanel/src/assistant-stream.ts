export type StreamingAssistant = { id: string; sessionId: string; text: string };

type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

type StreamCompletion = { id: string; resolve: () => void };

/**
 * Presents incoming assistant deltas one Unicode code point at a time.
 * Transport chunks can be large, so the rendered text is deliberately kept
 * separate from the accumulated target text.
 */
export function createAssistantStream(
  onUpdate: (assistant: StreamingAssistant | undefined) => void,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
  cancelFrame: CancelFrame = cancelAnimationFrame,
) {
  let current: StreamingAssistant | undefined;
  let targetText = "";
  let frame: number | undefined;
  let completion: StreamCompletion | undefined;

  function schedule() {
    if (frame !== undefined) return;
    frame = scheduleFrame(animate);
  }

  function animate() {
    frame = undefined;
    if (!current) return;

    const targetCharacters = Array.from(targetText);
    const renderedCharacters = Array.from(current.text);
    if (renderedCharacters.length < targetCharacters.length) {
      current = {
        ...current,
        text: renderedCharacters.concat(targetCharacters[renderedCharacters.length]).join(""),
      };
      onUpdate(current);
    }

    if (current.text === targetText) {
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
    onUpdate(undefined);
  }

  return { append, finish, clear };
}

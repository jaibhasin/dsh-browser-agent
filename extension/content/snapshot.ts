type SnapshotResult = { text: string };
const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";
const SCROLL_MESSAGE = "dsh-browser-scroll";
const CLICK_MESSAGE = "dsh-browser-click";
const TYPE_MESSAGE = "dsh-browser-type";
const LISTENER_INSTALLED_KEY = "__dshBrowserSnapshotListenerInstalled";
const REFS_KEY = "__dshBrowserSnapshotRefs";

// Reuse one listener when executeScript runs repeatedly in a tab.
const contentScriptState = globalThis as typeof globalThis & {
  [LISTENER_INSTALLED_KEY]?: boolean;
  [REFS_KEY]?: Map<number, Element>;
};
contentScriptState[REFS_KEY] ??= new Map();
if (!contentScriptState[LISTENER_INSTALLED_KEY]) {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    if (message.type === SNAPSHOT_MESSAGE) {
      sendResponse(collectSnapshot());
      return;
    }
    if (message.type === SCROLL_MESSAGE) {
      const direction = (message as { direction?: unknown }).direction;
      const value = (message as { value?: unknown }).value;
      if (!["up", "down", "left", "right"].includes(direction as string) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
        sendResponse({ error: "Invalid scroll parameters." });
        return;
      }
      const distance = direction === "up" || direction === "left" ? -value : value;
      window.scrollBy({ left: direction === "left" || direction === "right" ? distance : 0, top: direction === "up" || direction === "down" ? distance : 0, behavior: "instant" });
      sendResponse(collectSnapshot());
      return;
    }
    if (message.type === CLICK_MESSAGE) {
      const ref = (message as { ref?: unknown }).ref;
      sendResponse(clickRef(ref));
      return;
    }
    if (message.type === TYPE_MESSAGE) {
      const ref = (message as { ref?: unknown }).ref;
      const text = (message as { text?: unknown }).text;
      sendResponse(typeRef(ref, text));
    }
  });
  contentScriptState[LISTENER_INSTALLED_KEY] = true;
}

type ClickResult = { ok: true } | { ok: false; error: string };

function clickRef(value: unknown): ClickResult {
  if (!Number.isInteger(value) || (value as number) < 1) {
    return { ok: false, error: "Browser ref must be a positive integer." };
  }
  const element = contentScriptState[REFS_KEY]?.get(value as number);
  if (!element || !element.isConnected) return { ok: false, error: `No browser element found for ref [${value}]. Take a new browser_snapshot.` };
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.visualViewport?.width ?? document.documentElement.clientWidth;
  const viewportHeight = window.visualViewport?.height ?? document.documentElement.clientHeight;
  if (element.closest('[aria-hidden="true"]') || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 ||
    rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) {
    return { ok: false, error: `Browser ref [${value}] is no longer visible. Take a new browser_snapshot.` };
  }
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    return { ok: false, error: `Browser ref [${value}] is disabled.` };
  }
  (element as HTMLElement).click();
  return { ok: true };
}

type TypeResult = { typed: true } | { typed: false; error: string };

function typeRef(value: unknown, text: unknown): TypeResult {
  if (!Number.isInteger(value) || (value as number) < 1 || typeof text !== "string") return { typed: false, error: "Browser type requires a positive ref and text." };
  const element = contentScriptState[REFS_KEY]?.get(value as number);
  if (!element || !element.isConnected) return { typed: false, error: `No browser element found for ref [${value}]. Take a new browser_snapshot.` };
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.visualViewport?.width ?? document.documentElement.clientWidth;
  const viewportHeight = window.visualViewport?.height ?? document.documentElement.clientHeight;
  if (element.closest('[aria-hidden="true"]') || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 ||
    rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) {
    return { typed: false, error: `Browser ref [${value}] is no longer visible. Take a new browser_snapshot.` };
  }
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" || element.hasAttribute("readonly")) return { typed: false, error: `Browser ref [${value}] is disabled or readonly.` };
  if (element instanceof HTMLInputElement) {
    if (!["text", "search", "email", "url", "tel", "password", "number"].includes(element.type)) return { typed: false, error: "The referenced control is not a text input." };
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, text);
  } else if (element instanceof HTMLTextAreaElement) {
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, text);
  } else if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus();
    element.textContent = text;
  } else {
    return { typed: false, error: "The referenced control is not a text input." };
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { typed: true };
}

/** Runs in the current page and produces a bounded semantic DOM representation. */
function collectSnapshot(): SnapshotResult {
  const maxViewportNodes = 180;
  const maxOffscreenNodes = 70;
  const maxTextLength = 24_000;
  const viewportNodes: string[] = [];
  const offscreenNodes: string[] = [];
  const viewportControls: string[] = [];
  const offscreenControls: string[] = [];
  const refs = new Map<number, Element>();
  let nextRef = 1;
  const roles: Record<string, string> = { a: "link", button: "button", input: "textbox", select: "combobox", textarea: "textbox", main: "main", nav: "navigation", header: "banner", footer: "contentinfo", aside: "complementary", form: "form", table: "table", dialog: "dialog", article: "article", section: "region", p: "paragraph", img: "image", video: "video", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", ul: "list", ol: "list", li: "listitem" };
  const normalise = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
  const renderedState = (element: Element): "viewport" | "offscreen" | undefined => {
    const style = getComputedStyle(element);
    if (element.closest('[aria-hidden="true"]') || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return undefined;
    const viewportWidth = window.visualViewport?.width ?? document.documentElement.clientWidth;
    const viewportHeight = window.visualViewport?.height ?? document.documentElement.clientHeight;
    const rects = Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return undefined;
    return rects.some((rect) => rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth) ? "viewport" : "offscreen";
  };
  const accessibleName = (element: Element): string => {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      if (normalise(text)) return normalise(text);
    }
    const aria = element.getAttribute("aria-label");
    if (normalise(aria)) return normalise(aria);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent).join(" ") : "";
      if (normalise(labels)) return normalise(labels);
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && normalise(element.placeholder)) return normalise(element.placeholder);
    }
    const explicit = element.getAttribute("alt") ?? element.getAttribute("title");
    if (normalise(explicit)) return normalise(explicit).slice(0, 180);
    const tag = element.tagName.toLowerCase();
    if (!interactive(element) && !/^h[1-6]$/.test(tag) && tag !== "li" && tag !== "p") return "";
    return normalise(element.textContent).slice(0, 180);
  };
  const interactive = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    return tag === "button" || (tag === "a" && element.hasAttribute("href")) || (tag === "input" && (element as HTMLInputElement).type !== "hidden") || tag === "select" || tag === "textarea" || element.hasAttribute("contenteditable") || role === "textbox" || role === "button" || role === "link" || role === "menuitem" || role === "option" || role === "tab" || element.hasAttribute("onclick");
  };
  for (const element of Array.from(document.querySelectorAll("body *"))) {
    const rendered = renderedState(element);
    if (!rendered) continue;
    const nodes = rendered === "viewport" ? viewportNodes : offscreenNodes;
    const controls = rendered === "viewport" ? viewportControls : offscreenControls;
    const maxNodes = rendered === "viewport" ? maxViewportNodes : maxOffscreenNodes;
    if (nodes.length >= maxNodes) continue;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") ?? roles[tag];
    const isInteractive = interactive(element);
    if (!isInteractive && role === undefined && !/^h[1-6]$/.test(tag)) continue;
    const name = accessibleName(element);
    const suffix = name ? ` \"${name}\"` : "";
    let depth = 0; let parent = element.parentElement;
    while (parent && parent !== document.body) { depth += 1; parent = parent.parentElement; }
    nodes.push(`${"  ".repeat(Math.min(6, depth))}<${tag}${role ? ` role=${role}` : ""}>${suffix}`);
    if (isInteractive) {
      const state = [element.getAttribute("aria-expanded") && `expanded=${element.getAttribute("aria-expanded")}`, (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") && "disabled"].filter(Boolean).join(" ");
      const ref = nextRef++;
      refs.set(ref, element);
      controls.push(`[${ref}] ${role ?? tag}${suffix}${state ? ` ${state}` : ""}`);
    }
  }
  contentScriptState[REFS_KEY] = refs;
  const viewportWidth = Math.round(window.visualViewport?.width ?? document.documentElement.clientWidth);
  const viewportHeight = Math.round(window.visualViewport?.height ?? document.documentElement.clientHeight);
  const text = [
    `URL: ${location.href}`,
    `Title: ${document.title}`,
    `Viewport: ${viewportWidth}x${viewportHeight} at scroll (${Math.round(scrollX)}, ${Math.round(scrollY)})`,
    "",
    "Interactive elements currently visible in the viewport:",
    ...(viewportControls.length ? viewportControls : ["(none found)"]),
    "",
    "Semantic DOM / accessibility projection for the current viewport:",
    ...(viewportNodes.length ? viewportNodes : ["(no visible semantic elements found)"]),
    "",
    "Rendered but offscreen elements (not currently visible, may require scrolling):",
    ...(offscreenControls.length ? offscreenControls : ["(no offscreen interactive elements found)"]),
    ...(offscreenNodes.length ? offscreenNodes : ["(no offscreen semantic elements found)"]),
    "",
    "Intentionally hidden, transparent, zero-size, and aria-hidden elements are omitted.",
  ].join("\n");
  return { text: text.length > maxTextLength ? `${text.slice(0, maxTextLength)}\n[truncated]` : text };
}

type SnapshotResult = { text: string };
const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message) || message.type !== SNAPSHOT_MESSAGE) return;
  sendResponse(collectSnapshot());
});

/** Runs in the current page and produces a bounded semantic DOM representation. */
function collectSnapshot(): SnapshotResult {
  const maxNodes = 250;
  const maxTextLength = 24_000;
  const nodes: string[] = [];
  const controls: string[] = [];
  const roles: Record<string, string> = { a: "link", button: "button", input: "textbox", select: "combobox", textarea: "textbox", main: "main", nav: "navigation", header: "banner", footer: "contentinfo", aside: "complementary", form: "form", table: "table", dialog: "dialog", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", ul: "list", ol: "list", li: "listitem" };
  const normalise = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
  const isVisible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden";
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
    return normalise(element.getAttribute("alt") ?? element.getAttribute("title") ?? element.textContent).slice(0, 180);
  };
  const interactive = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    return tag === "button" || (tag === "a" && element.hasAttribute("href")) || (tag === "input" && (element as HTMLInputElement).type !== "hidden") || tag === "select" || tag === "textarea" || element.hasAttribute("contenteditable") || element.getAttribute("role") === "button" || element.hasAttribute("onclick");
  };
  for (const element of Array.from(document.querySelectorAll("body *"))) {
    if (nodes.length >= maxNodes || !isVisible(element)) continue;
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
      const state = [element.getAttribute("aria-expanded") && `expanded=${element.getAttribute("aria-expanded")}`, element.hasAttribute("disabled") && "disabled"].filter(Boolean).join(" ");
      controls.push(`[${controls.length + 1}] ${role ?? tag}${suffix}${state ? ` ${state}` : ""}`);
    }
  }
  const text = [`URL: ${location.href}`, `Title: ${document.title}`, "", "Interactive elements:", ...(controls.length ? controls : ["(none found)"]), "", "Semantic DOM / accessibility projection:", ...(nodes.length ? nodes : ["(no visible semantic elements found)"])].join("\n");
  return { text: text.length > maxTextLength ? `${text.slice(0, maxTextLength)}\n[truncated]` : text };
}

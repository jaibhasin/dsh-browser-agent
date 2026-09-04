import type { JsonValue } from "../../shared/protocol";
import { ensureAgentTab } from "./agent-tab";

const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";
const SCROLL_MESSAGE = "dsh-browser-scroll";
type SnapshotResult = { text: string };
type BrowserScreenshotResult = { data: string; mediaType: "image/png" };
type ScrollDirection = "up" | "down" | "left" | "right";
const CLICK_MESSAGE = "dsh-browser-click";
const TYPE_MESSAGE = "dsh-browser-type";
const WAIT_MESSAGE = "dsh-browser-wait";
type ClickResult = { ok: true } | { ok: false; error: string };
type TypeResult = { typed: true } | { typed: false; error: string };
type WaitResult = {
  settled: boolean;
  waitedMs: number;
  documentComplete: boolean;
  domQuietForMs: number;
  busyElements: number;
  text: string;
};
export type BrowserTab = {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
};

function toBrowserTab(tab: chrome.tabs.Tab): BrowserTab {
  if (tab.id === undefined || tab.windowId === undefined) throw new Error("The browser returned a tab without an ID.");
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active,
  };
}

/** Read the agent-owned tab's snapshot. */
export async function captureBrowserSnapshot(): Promise<JsonValue> {
  const tab = await ensureAgentTab();
  if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: SNAPSHOT_MESSAGE }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { text?: unknown }).text !== "string") {
    throw new Error("The content script returned an invalid snapshot.");
  }
  return result as SnapshotResult;
}

/** Capture the agent-owned tab when it is visible in its window. */
export async function captureBrowserScreenshot(): Promise<JsonValue> {
  const tab = await ensureAgentTab();
  if (tab?.windowId === undefined) throw new Error("No active browser tab is available.");
  if (!tab.active) throw new Error("The agent tab must be visible before it can be captured. Open the highlighted Agent tab, then retry the screenshot.");
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (typeof data !== "string" || !data.startsWith("data:image/png;base64,")) {
    throw new Error("The browser returned an invalid screenshot.");
  }
  return { data: data.slice("data:image/png;base64,".length), mediaType: "image/png" } satisfies BrowserScreenshotResult;
}

/** Scroll the agent-owned tab and return its new snapshot. */
export async function scrollBrowser(direction: ScrollDirection, value: number): Promise<JsonValue> {
  const tab = await ensureAgentTab();
  if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: SCROLL_MESSAGE, direction, value }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { text?: unknown }).text !== "string") {
    throw new Error("The content script returned an invalid scroll result.");
  }
  return result as SnapshotResult;
}

/** Click a ref from the latest snapshot. */
export async function clickBrowserRef(ref: number): Promise<JsonValue> {
  const tab = await ensureAgentTab();
  if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: CLICK_MESSAGE, ref }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { ok?: unknown }).ok !== "boolean") {
    throw new Error("The content script returned an invalid click result.");
  }
  const click = result as ClickResult;
  if (!click.ok) throw new Error(click.error);
  return { clicked: true };
}

/** Fill a text control from the latest snapshot. */
export async function typeBrowserRef(ref: number, text: string): Promise<JsonValue> {
  const tab = await ensureAgentTab();
  if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: TYPE_MESSAGE, ref, text }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { typed?: unknown }).typed !== "boolean") {
    throw new Error("The content script returned an invalid type result.");
  }
  const typed = result as TypeResult;
  if (!typed.typed) throw new Error(typed.error);
  return { typed: true };
}

/** Wait for a short quiet period and return a fresh snapshot with readiness signals. */
export async function waitForBrowserSettled(timeoutMs: number): Promise<JsonValue> {
  const tab = await ensureAgentTab();
  if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: WAIT_MESSAGE, timeoutMs }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) ||
    typeof (result as { settled?: unknown }).settled !== "boolean" ||
    typeof (result as { waitedMs?: unknown }).waitedMs !== "number" ||
    typeof (result as { documentComplete?: unknown }).documentComplete !== "boolean" ||
    typeof (result as { domQuietForMs?: unknown }).domQuietForMs !== "number" ||
    typeof (result as { busyElements?: unknown }).busyElements !== "number" ||
    typeof (result as { text?: unknown }).text !== "string") {
    throw new Error("The content script returned an invalid page wait result.");
  }
  return result as WaitResult;
}

/** Navigate the agent-owned tab to an HTTP(S) URL. */
export async function navigateBrowser(url: string): Promise<JsonValue> {
  const agentTab = await ensureAgentTab();
  if (agentTab.id === undefined) throw new Error("The agent tab is unavailable.");
  await chrome.tabs.update(agentTab.id, { url });
  const tab = await waitForTabLoad(agentTab.id, 2_500);
  return { tab: toBrowserTab(tab) };
}

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve) => {
    let complete = false;
    const finish = (tab: chrome.tabs.Tab) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    };
    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(tab);
    };
    const timeout = setTimeout(async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (tab) finish(tab);
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish(tab);
    }).catch(() => undefined);
  });
}

/** List every currently open browser tab. */
export async function listBrowserTabs(): Promise<JsonValue> {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.filter((tab) => tab.id !== undefined && tab.windowId !== undefined).map(toBrowserTab) };
}

/** Focus the tab's window and make that tab active. */
export async function switchBrowserTab(id: number): Promise<JsonValue> {
  const existing = await chrome.tabs.get(id).catch(() => undefined);
  if (!existing || existing.windowId === undefined) throw new Error(`No browser tab exists with ID ${id}.`);
  await chrome.windows.update(existing.windowId, { focused: true });
  const tab = await chrome.tabs.update(id, { active: true });
  return { tab: toBrowserTab(tab) };
}

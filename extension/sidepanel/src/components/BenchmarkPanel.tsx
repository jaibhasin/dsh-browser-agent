import { useEffect, useMemo, useState } from "react";
import { selectedBenchmarkTabs, toggleBenchmarkTab } from "../../../../shared/benchmark-selection";
import type { BenchmarkRunState, BenchmarkTab, BenchmarkTabsResponse, BenchmarkRunResponse } from "../../../../shared/benchmark";

type BenchmarkPanelProps = { open: boolean; onClose: () => void };

const DEFAULT_PROMPT = "Inspect only your assigned tab. Read the current page, then scroll down up to three times, taking a fresh snapshot after each scroll. Stop scrolling if no new content appears. Return the page title, a short summary, five key facts supported by the page, and any information you could not verify. Do not switch tabs, follow links, submit forms, or ask questions. If the page cannot be read, explain why and stop.";

export function BenchmarkPanel({ open, onClose }: BenchmarkPanelProps) {
  const [tabs, setTabs] = useState<BenchmarkTab[]>([]);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [run, setRun] = useState<BenchmarkRunState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  async function refreshTabs() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-benchmark-tabs" }) as BenchmarkTabsResponse;
      if (!response?.ok) { setError(response?.error ?? "Could not list browser tabs."); return; }
      setTabs(response.tabs);
    } catch {
      setError("Could not refresh tabs. Reload the extension and reopen Memory test.");
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    setError("");
    void chrome.runtime.sendMessage({ type: "dsh-benchmark-panel-opened" }).catch(() => undefined);
    void refreshTabs();
    const refreshRun = () => {
      setNow(Date.now());
      void chrome.runtime.sendMessage({ type: "dsh-benchmark-state-request" }).then((response: { state?: BenchmarkRunState }) => {
        if (response?.state) {
          setRun(response.state);
          setBusy(response.state.phase !== "completed");
        }
      }).catch(() => undefined);
    };
    refreshRun();
    const timer = window.setInterval(() => { void refreshTabs(); refreshRun(); }, 1000);
    const onMessage = (message: { type?: string; state?: BenchmarkRunState }) => {
      if (message.type === "dsh-benchmark-state" && message.state) {
        setRun(message.state);
        setBusy(message.state.phase !== "completed");
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      window.clearInterval(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [open]);

  const selectedTabs = useMemo(() => selectedBenchmarkTabs(tabs, selected), [selected, tabs]);
  const allSelected = tabs.length > 0 && selectedTabs.length === tabs.length;
  const cooldownSeconds = Math.max(0, Math.ceil(((run?.settledAt ?? now) + 60_000 - now) / 1000));
  if (!open) return null;

  function toggleTab(id: number) {
    setSelected((current) => toggleBenchmarkTab(tabs, current, id));
  }

  async function runBenchmark() {
    if (!prompt.trim() || selectedTabs.length === 0 || busy) return;
    setError("");
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-benchmark-run", prompt, tabIds: selectedTabs.map((tab) => tab.id) }) as BenchmarkRunResponse;
      if (!response?.ok) { setError(response?.error ?? "Could not start the benchmark."); setBusy(false); }
    } catch {
      setError("Could not start tasks. Reload the extension and try again.");
      setBusy(false);
    }
  }

  const completed = run?.tasks.filter((task) => task.state === "completed").length ?? 0;
  const failed = run?.tasks.filter((task) => task.state === "failed").length ?? 0;

  return (
    <section className="benchmark-panel" aria-label="Memory benchmark">
      <div className="benchmark-panel-header">
        <div>
          <p className="eyebrow">Memory benchmark</p>
          <h2>Run tasks in parallel</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close memory benchmark">×</button>
      </div>
      <p className="benchmark-copy">Open websites in this window, choose the tabs below, then click Run. This prompt runs once per selected tab, all in parallel. No need to paste it into separate chats.</p>
      <label className="benchmark-label" htmlFor="benchmark-prompt">One prompt for all selected tabs</label>
      <textarea id="benchmark-prompt" className="benchmark-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} disabled={busy} />
      <div className="benchmark-sites" aria-label="Open test websites">
        <span>Open a test site:</span>
        {[["YouTube", "https://www.youtube.com/"], ["Hacker News", "https://news.ycombinator.com/"], ["Reddit", "https://www.reddit.com/"]].map(([name, url]) => (
          <button key={url} type="button" className="text-button" disabled={busy} onClick={() => void chrome.tabs.create({ url, active: false }).then(() => refreshTabs()).catch(() => setError(`Could not open ${name}. Open ${url} in a tab.`))}>{name}</button>
        ))}
      </div>
      <div className="benchmark-tabs-header">
        <span role="status">{selectedTabs.length} of {tabs.length} web tabs selected</span>
        {tabs.length > 0 && <button type="button" className="text-button" onClick={() => setSelected(allSelected ? new Set() : null)} disabled={busy}>{allSelected ? "Deselect all" : "Select all"}</button>}
      </div>
      <div className="benchmark-tabs">
        {tabs.length === 0 && <>
          <p className="benchmark-empty">New Tab and chrome:// pages cannot be tested. Enter a website address in each tab first.</p>
        </>}
        {tabs.map((tab) => (
          <label className="benchmark-tab" key={tab.id}>
            <input type="checkbox" checked={selected === null || selected.has(tab.id)} onChange={() => toggleTab(tab.id)} disabled={busy} />
            <span><strong>{tab.title || "Untitled page"}</strong><small>{tab.url}</small></span>
          </label>
        ))}
      </div>
      {run && (
        <div className="benchmark-progress" role="status">
          <strong>{run.recordingError ? "Memory recording interrupted." : run.phase === "cooldown" ? `Cooldown: ${cooldownSeconds}s remaining. Leave tabs open.` : run.phase === "completed" ? "Tasks and cooldown finished. Check your terminal for the report." : `${run.tabCount} tasks are running in parallel.`}</strong>
          <span>{completed} completed{failed ? ` · ${failed} failed` : ""}{run.phase === "cooldown" ? " · collecting cooldown" : ""}</span>
          <span>Responses are saved in Chat history as “Memory test: [page title]”.</span>
          <small>Run: {run.runId}</small>
        </div>
      )}
      {error && <p className="benchmark-error" role="alert">{error}</p>}
      {run?.recordingError && <p className="benchmark-error" role="alert">{run.recordingError}</p>}
      <button type="button" className="benchmark-run-button" onClick={() => void runBenchmark()} disabled={busy || selectedTabs.length === 0 || !prompt.trim()}>
        {busy ? "Running benchmark..." : tabs.length === 0 ? "Open a website to start" : selectedTabs.length === 0 ? "Select tabs to start" : `Run ${selectedTabs.length} task${selectedTabs.length === 1 ? "" : "s"} in parallel`}
      </button>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { BenchmarkRunState, BenchmarkTab, BenchmarkTabsResponse, BenchmarkRunResponse } from "../../../../shared/benchmark";

type BenchmarkPanelProps = { open: boolean; onClose: () => void };

const DEFAULT_PROMPT = "Read this page and return its title and three key points. Do not navigate, click, type, or ask questions.";

export function BenchmarkPanel({ open, onClose }: BenchmarkPanelProps) {
  const [tabs, setTabs] = useState<BenchmarkTab[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [run, setRun] = useState<BenchmarkRunState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const initializedSelection = useRef(false);

  async function refreshTabs() {
    const response = await chrome.runtime.sendMessage({ type: "dsh-benchmark-tabs" }) as BenchmarkTabsResponse;
    if (!response?.ok) { setError(response?.error ?? "Could not list browser tabs."); return; }
    setTabs(response.tabs);
    setSelected((current) => {
      if (!initializedSelection.current) {
        initializedSelection.current = true;
        return new Set(response.tabs.map((tab) => tab.id));
      }
      return new Set([...current].filter((id) => response.tabs.some((tab) => tab.id === id)));
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    setError("");
    void chrome.runtime.sendMessage({ type: "dsh-benchmark-panel-opened" });
    void refreshTabs();
    const timer = window.setInterval(() => void refreshTabs(), 2000);
    const onMessage = (message: { type?: string; state?: BenchmarkRunState }) => {
      if (message.type === "dsh-benchmark-state" && message.state) {
        setRun(message.state);
        if (message.state.phase === "completed") setBusy(false);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      window.clearInterval(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [open]);

  const selectedTabs = useMemo(() => tabs.filter((tab) => selected.has(tab.id)), [selected, tabs]);
  if (!open) return null;

  function toggleTab(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runBenchmark() {
    if (!prompt.trim() || selectedTabs.length === 0 || busy) return;
    setError("");
    setBusy(true);
    const response = await chrome.runtime.sendMessage({ type: "dsh-benchmark-run", prompt, tabIds: selectedTabs.map((tab) => tab.id) }) as BenchmarkRunResponse;
    if (!response?.ok) { setError(response?.error ?? "Could not start the benchmark."); setBusy(false); }
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
      <p className="benchmark-copy">Choose any open pages. The benchmark records Chrome and DSH memory while every selected task runs at the same time.</p>
      <label className="benchmark-label" htmlFor="benchmark-prompt">Prompt for each tab</label>
      <textarea id="benchmark-prompt" className="benchmark-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} disabled={busy} />
      <div className="benchmark-tabs-header">
        <span>{tabs.length} eligible tabs detected</span>
        <button type="button" className="text-button" onClick={() => setSelected(new Set(tabs.map((tab) => tab.id)))} disabled={busy || tabs.length === 0}>Select all</button>
      </div>
      <div className="benchmark-tabs">
        {tabs.length === 0 && <p className="benchmark-empty">Open one or more regular web pages in this Chrome window.</p>}
        {tabs.map((tab) => (
          <label className="benchmark-tab" key={tab.id}>
            <input type="checkbox" checked={selected.has(tab.id)} onChange={() => toggleTab(tab.id)} disabled={busy} />
            <span><strong>{tab.title || "Untitled page"}</strong><small>{tab.url}</small></span>
          </label>
        ))}
      </div>
      {run && (
        <div className="benchmark-progress" role="status">
          <strong>{run.phase === "cooldown" ? "Tasks finished. Cooldown is running." : run.phase === "completed" ? "Benchmark complete." : "Tasks are running in parallel."}</strong>
          <span>{completed} completed{failed ? ` · ${failed} failed` : ""}{run.phase === "cooldown" ? " · collecting cooldown" : ""}</span>
        </div>
      )}
      {error && <p className="benchmark-error" role="alert">{error}</p>}
      <button type="button" className="benchmark-run-button" onClick={() => void runBenchmark()} disabled={busy || selectedTabs.length === 0 || !prompt.trim()}>
        {busy ? "Running benchmark..." : `Run ${selectedTabs.length} task${selectedTabs.length === 1 ? "" : "s"} in parallel`}
      </button>
    </section>
  );
}

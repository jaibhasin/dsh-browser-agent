import { useEffect, useMemo, useState } from "react";
import { selectedBenchmarkTabs, toggleBenchmarkTab } from "../../../../shared/benchmark-selection";
import type { BenchmarkRunState, BenchmarkRunTask, BenchmarkTab, BenchmarkTabsResponse, BenchmarkRunResponse } from "../../../../shared/benchmark";
import { BENCHMARK_SITES, benchmarkSite, benchmarkSiteForUrl, DEFAULT_BENCHMARK_SITE_ID, type BenchmarkSiteId } from "../../../../shared/benchmark-sites";

type BenchmarkPanelProps = { open: boolean; onClose: () => void };
type SiteRecord<T> = Record<BenchmarkSiteId, T>;

const MAX_TABS_PER_SITE = 50;
const DEFAULT_PROMPTS = Object.fromEntries(BENCHMARK_SITES.map((site) => [site.id, site.prompt])) as SiteRecord<string>;
const DEFAULT_TAB_COUNTS = Object.fromEntries(BENCHMARK_SITES.map((site) => [site.id, "1"])) as SiteRecord<string>;

export function BenchmarkPanel({ open, onClose }: BenchmarkPanelProps) {
  const [tabs, setTabs] = useState<BenchmarkTab[]>([]);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [siteId, setSiteId] = useState<BenchmarkSiteId>(DEFAULT_BENCHMARK_SITE_ID);
  const [prompts, setPrompts] = useState<SiteRecord<string>>(DEFAULT_PROMPTS);
  const [tabCounts, setTabCounts] = useState<SiteRecord<string>>(DEFAULT_TAB_COUNTS);
  const [run, setRun] = useState<BenchmarkRunState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creatingSiteId, setCreatingSiteId] = useState<BenchmarkSiteId>();
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
  const selectedSite = benchmarkSite(siteId);
  // A running agent may navigate away from its starting site, so live URL
  // changes must not turn into a new selection error during the run.
  const unsupportedTabs = busy ? [] : selectedTabs.filter((tab) => !benchmarkSiteForUrl(tab.url));
  const selectedSiteNames = [...new Set(selectedTabs.map((tab) => benchmarkSiteForUrl(tab.url)?.name).filter((name): name is string => Boolean(name)))];
  const allSelected = tabs.length > 0 && selectedTabs.length === tabs.length;
  const cooldownSeconds = Math.max(0, Math.ceil(((run?.settledAt ?? now) + 60_000 - now) / 1000));
  const selectedPrompt = prompts[siteId];
  if (!open) return null;

  function toggleTab(id: number) {
    setSelected((current) => toggleBenchmarkTab(tabs, current, id));
  }

  function chooseSite(id: BenchmarkSiteId) {
    setSiteId(id);
  }

  function selectSupportedTabs() {
    setSelected(new Set(tabs.filter((tab) => benchmarkSiteForUrl(tab.url)).map((tab) => tab.id)));
  }

  async function createSiteTabs(siteIdToCreate: BenchmarkSiteId) {
    const site = benchmarkSite(siteIdToCreate);
    const count = Number(tabCounts[siteIdToCreate]);
    if (!Number.isInteger(count) || count < 1 || count > MAX_TABS_PER_SITE) {
      setError(`Enter a whole number from 1 to ${MAX_TABS_PER_SITE} for ${site.name}.`);
      return;
    }
    setError("");
    setCreatingSiteId(siteIdToCreate);
    try {
      const created = await Promise.all(Array.from({ length: count }, () => chrome.tabs.create({ url: site.url, active: false })));
      const createdIds = created.map((tab) => tab.id).filter((id): id is number => id !== undefined);
      setSelected((current) => current === null ? null : new Set([...current, ...createdIds]));
      await refreshTabs();
    } catch {
      setError(`Could not create ${site.name} tabs. Open ${site.url} manually and try again.`);
    } finally {
      setCreatingSiteId(undefined);
    }
  }

  async function runBenchmark() {
    if (selectedTabs.length === 0 || unsupportedTabs.length > 0 || busy) return;
    const tasks: BenchmarkRunTask[] = selectedTabs.flatMap((tab) => {
      const site = benchmarkSiteForUrl(tab.url);
      if (!site) return [];
      return [{ tabId: tab.id, prompt: prompts[site.id].trim() }];
    });
    if (tasks.some((task) => !task.prompt)) {
      setError("Add a prompt for every site represented in the selected tabs.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "dsh-benchmark-run", tasks }) as BenchmarkRunResponse;
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
      <p className="benchmark-copy">Choose a site task, open matching tabs in this window, select them below, then click Run. The task runs once per selected tab, all in parallel.</p>
      <label className="benchmark-label" htmlFor="benchmark-site">Task preset</label>
      <select id="benchmark-site" className="benchmark-site-select" value={siteId} onChange={(event) => chooseSite(event.target.value as BenchmarkSiteId)} disabled={busy}>
        {BENCHMARK_SITES.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
      <p className="benchmark-site-hint">Preset for {selectedSite.name}. Mixed runs use each tab's matching site prompt.</p>
      <label className="benchmark-label" htmlFor="benchmark-prompt">Prompt for {selectedSite.name} tabs</label>
      <textarea id="benchmark-prompt" className="benchmark-prompt" value={selectedPrompt} onChange={(event) => setPrompts((current) => ({ ...current, [siteId]: event.target.value }))} rows={4} disabled={busy} />
      <div className="benchmark-site-builders" aria-label="Create benchmark tabs">
        {BENCHMARK_SITES.map((site) => (
          <div className="benchmark-site-builder" key={site.id}>
            <div className="benchmark-site-builder-copy">
              <strong>{site.name}</strong>
              <small>Open copies of this site</small>
            </div>
            <label className="benchmark-count-label" htmlFor={`benchmark-count-${site.id}`}>
              <span>Tabs</span>
              <input id={`benchmark-count-${site.id}`} className="benchmark-count-input" type="number" min="1" max={MAX_TABS_PER_SITE} step="1" value={tabCounts[site.id]} onChange={(event) => setTabCounts((current) => ({ ...current, [site.id]: event.target.value }))} disabled={busy || creatingSiteId !== undefined} />
            </label>
            <button type="button" className="text-button benchmark-create-button" disabled={busy || creatingSiteId !== undefined} onClick={() => void createSiteTabs(site.id)}>{creatingSiteId === site.id ? "Creating..." : "Create tabs"}</button>
          </div>
        ))}
      </div>
      <div className="benchmark-tabs-header">
        <span role="status">{selectedTabs.length} of {tabs.length} web tabs selected</span>
        {tabs.length > 0 && <span className="benchmark-tab-actions"><button type="button" className="text-button" onClick={selectSupportedTabs} disabled={busy}>Select supported tabs</button><button type="button" className="text-button" onClick={() => setSelected(allSelected ? new Set() : null)} disabled={busy}>{allSelected ? "Deselect all" : "Select all"}</button></span>}
      </div>
      <div className="benchmark-tabs">
        {tabs.length === 0 && <>
          <p className="benchmark-empty">New Tab and chrome:// pages cannot be tested. Enter a website address in each tab first.</p>
        </>}
        {tabs.map((tab) => (
          <label className="benchmark-tab" key={tab.id}>
            <input type="checkbox" checked={selected === null || selected.has(tab.id)} onChange={() => toggleTab(tab.id)} disabled={busy} />
            <span><strong>{tab.title || "Untitled page"}</strong><small>{benchmarkSiteForUrl(tab.url)?.name ?? "Unsupported site"} · {tab.url}</small></span>
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
      {unsupportedTabs.length > 0 && <p className="benchmark-error" role="alert">{unsupportedTabs.length} selected tab{unsupportedTabs.length === 1 ? " is" : "s are"} not one of the supported benchmark sites. Select supported tabs or deselect the unsupported tabs.</p>}
      {selectedTabs.length > 0 && unsupportedTabs.length === 0 && <p className="benchmark-site-hint" role="status">Ready to run {selectedTabs.length} agent{selectedTabs.length === 1 ? "" : "s"} across {selectedSiteNames.length} site{selectedSiteNames.length === 1 ? "" : "s"}.</p>}
      {error && <p className="benchmark-error" role="alert">{error}</p>}
      {run?.recordingError && <p className="benchmark-error" role="alert">{run.recordingError}</p>}
      <button type="button" className="benchmark-run-button" onClick={() => void runBenchmark()} disabled={busy || creatingSiteId !== undefined || selectedTabs.length === 0 || unsupportedTabs.length > 0}>
        {busy ? "Running benchmark..." : tabs.length === 0 ? "Create tabs to start" : selectedTabs.length === 0 ? "Select tabs to start" : `Run all ${selectedTabs.length} agent${selectedTabs.length === 1 ? "" : "s"} in parallel`}
      </button>
    </section>
  );
}

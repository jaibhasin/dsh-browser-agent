import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseSamples, renderReportDirectory, writeMemoryCharts } from "../evals/memory-benchmark/memory-chart.mjs";
import { recordTaskEvent } from "../evals/memory-benchmark/task-recording.mjs";

test("task recording keeps site prompts and final outcomes through duplicate events", () => {
  const tasks = new Map();
  recordTaskEvent(tasks, { type: "run_started", runId: "run-1", tabCount: 2, timestamp: 1_000, tasks: [
    { taskId: "a", tabId: 1, site: "Hacker News", prompt: "same prompt" },
    { taskId: "b", tabId: 2, site: "Hacker News", prompt: "same prompt" },
  ] });
  recordTaskEvent(tasks, { type: "task_finished", runId: "run-1", taskId: "a", tabId: 1, state: "completed", timestamp: 4_000, activeTaskCount: 1 });
  recordTaskEvent(tasks, { type: "task_started", runId: "run-1", taskId: "a", tabId: 1, activeTaskCount: 2, timestamp: 2_000 });
  recordTaskEvent(tasks, { type: "run_settled", runId: "run-1", tabCount: 2, timestamp: 5_000, tasks: [{ taskId: "a", tabId: 1, state: "completed", finishedAt: 4_000 }, { taskId: "b", tabId: 2, state: "failed", finishedAt: 5_000, error: "timed out" }] });
  assert.deepEqual(tasks.get("a"), { taskId: "a", tabId: 1, site: "Hacker News", prompt: "same prompt", state: "completed", startedAt: 2_000, finishedAt: 4_000 });
  assert.equal(tasks.get("b").prompt, "same prompt");
  assert.equal(tasks.get("b").error, "timed out");
});

test("memory report renderer parses quoted CSV and writes shareable artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-memory-report-"));
  try {
    await writeFile(join(directory, "summary.json"), JSON.stringify({ startedAt: 1_000, runStartedAt: 1_000, elapsedSeconds: 5, tabCount: 2, peakIncreaseMiB: 120, retainedMiB: 40, tasks: [
      { taskId: "a", tabId: 1, site: "Hacker News", title: "HN", prompt: "Read, rank", state: "completed", startedAt: 2_000, finishedAt: 4_000 },
      { taskId: "b", tabId: 2, site: "Wikipedia", title: "Apollo", prompt: "Brief it", state: "failed", startedAt: 2_000, finishedAt: 5_000, error: "No response" },
    ] }));
    await writeFile(join(directory, "samples.csv"), "timestamp,elapsed_seconds,phase,chrome_rss_mib,dsh_rss_mib,total_rss_mib\nnow,0,\"baseline, warm\",100,20,120\nthen,5,working,200,30,230\n");
    assert.equal(parseSamples(await readFile(join(directory, "samples.csv"), "utf8"))[0].phase, "baseline, warm");
    renderReportDirectory(directory);
    for (const file of ["memory-chart.svg", "task-timeline.svg", "memory-chart.png", "task-timeline.png", "report.html"]) assert.ok((await readFile(join(directory, file))).length > 100, file);
    assert.equal((await readFile(join(directory, "report.html"), "utf8")).includes("Hacker News"), true);
    assert.deepEqual([...await readFile(join(directory, "memory-chart.png"))].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("live benchmark samples draw memory and keep missing values unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-live-memory-report-"));
  try {
    const summary = { startedAt: 1_000, runStartedAt: 2_000, elapsedSeconds: 120, tabCount: 1, peakIncreaseMiB: null, retainedMiB: null, tasks: [
      { taskId: "a", tabId: 1, site: "Hacker News", title: "Front page", prompt: "Rank stories", state: "completed", startedAt: 2_500, finishedAt: 5_000 },
    ] };
    writeMemoryCharts(directory, summary, [
      { elapsedSeconds: 0, phase: "baseline", chromeMiB: 0, dshMiB: 40, totalMiB: 40, chromeProcesses: 0, dshProcesses: 1 },
      { elapsedSeconds: 2, phase: "working", chromeMiB: 500, dshMiB: 70, totalMiB: 570, chromeProcesses: 8, dshProcesses: 1 },
    ]);
    const chart = await readFile(join(directory, "memory-chart.svg"), "utf8");
    const timeline = await readFile(join(directory, "task-timeline.svg"), "utf8");
    assert.match(chart, /<path d="M[^"]+" fill="none" stroke="#66b3ff"/);
    assert.match(chart, /Peak \+unavailable · Retained \+unavailable/);
    assert.match(chart, /same prompt · last result \+3\.0s/);
    assert.match(timeline, /2\.5s duration · finished \+3\.0s/);
    assert.match(timeline, />\+3s<\/text>/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

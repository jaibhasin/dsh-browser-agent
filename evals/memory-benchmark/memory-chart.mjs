import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const COLORS = { background: "#0b1020", panel: "#141c31", grid: "#2a3856", text: "#eef3ff", muted: "#9ca9c5", chrome: "#66b3ff", dsh: "#b992ff", complete: "#55d68a", failed: "#ff7d82", pending: "#f5bd5c" };
const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
const formatMiB = (value) => finite(value) ? `${Number(value).toFixed(0)} MiB` : "unavailable";
const formatSeconds = (value) => finite(value) ? `${Number(value).toFixed(1)}s` : "unavailable";
const shortText = (value, length = 22) => String(value ?? "").length > length ? `${String(value).slice(0, length - 1)}…` : String(value ?? "");

function normalizeSample(sample) {
  const chromeProcesses = sample.chromeProcesses ?? sample.chrome_processes;
  const dshProcesses = sample.dshProcesses ?? sample.dsh_processes;
  const chrome = sample.chromeMiB ?? sample.chrome_rss_mib;
  const dsh = sample.dshMiB ?? sample.dsh_rss_mib;
  const total = sample.totalMiB ?? sample.total_rss_mib;
  return {
    ...sample,
    elapsed_seconds: number(sample.elapsedSeconds ?? sample.elapsed_seconds),
    chrome_rss_mib: number(chromeProcesses, 1) === 0 || !finite(chrome) ? null : Number(chrome),
    dsh_rss_mib: number(dshProcesses, 1) === 0 || !finite(dsh) ? null : Number(dsh),
    total_rss_mib: !finite(total) ? null : Number(total),
    phase: String(sample.phase ?? "unknown"),
  };
}

export function parseSamples(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const fields = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = !quoted;
      else if (character === "," && !quoted) { fields.push(field); field = ""; }
      else field += character;
    }
    fields.push(field);
    return Object.fromEntries(headers.map((header, index) => [header, fields[index]]));
  }).map(normalizeSample);
}

function taskGroups(summary) {
  const groups = new Map();
  for (const task of summary.tasks ?? []) {
    const site = task.site || "Unknown site";
    const group = groups.get(site) ?? { site, tasks: [] };
    group.tasks.push(task);
    groups.set(site, group);
  }
  return [...groups.values()];
}

function taskStats(summary) {
  const tasks = summary.tasks ?? [];
  const total = summary.tabCount ?? tasks.length;
  const completed = tasks.filter((task) => task.state === "completed").length;
  const failed = tasks.filter((task) => task.state === "failed").length;
  const pending = tasks.filter((task) => !["completed", "failed"].includes(task.state)).length;
  return { total, completed, failed, pending, unreported: Math.max(0, total - completed - failed - pending) };
}

function linePath(points, x, y, key) {
  let path = "";
  let open = false;
  for (const point of points) {
    if (!finite(point[key])) { open = false; continue; }
    path += `${open ? "L" : "M"}${x(point.elapsed_seconds).toFixed(1)},${y(point[key]).toFixed(1)} `;
    open = true;
  }
  return path.trim();
}

function overviewSvg(summary, samples) {
  samples = samples.map(normalizeSample);
  const width = 1440;
  const height = 900;
  const left = 86;
  const right = 45;
  const top = 170;
  const graphHeight = 395;
  const graphWidth = width - left - right;
  const maxX = Math.max(1, ...samples.map((sample) => number(sample.elapsed_seconds)));
  const maxY = Math.max(100, ...samples.flatMap((sample) => [number(sample.chrome_rss_mib), number(sample.dsh_rss_mib)]));
  const x = (value) => left + (number(value) / maxX) * graphWidth;
  const y = (value) => top + graphHeight - (number(value) / maxY) * graphHeight;
  const stats = taskStats(summary);
  const title = summary.synthetic ? "Synthetic benchmark preview" : "DSH memory benchmark";
  const syntheticLabel = summary.synthetic ? `<rect x="70" y="112" width="164" height="28" rx="14" fill="${COLORS.pending}"/><text x="152" y="131" text-anchor="middle" fill="${COLORS.background}" font-size="13" font-weight="700">SYNTHETIC DATA</text>` : "";
  const groups = taskGroups(summary);
  const phaseRanges = ["baseline", "working", "cooldown"].map((phase) => { const phaseSamples = samples.filter((sample) => sample.phase === phase); return phaseSamples.length ? { phase, from: phaseSamples[0].elapsed_seconds, to: phaseSamples.at(-1).elapsed_seconds } : null; }).filter(Boolean);
  const bands = phaseRanges.map(({ phase, from, to }) => `<rect x="${x(from)}" y="${top}" width="${Math.max(1, x(to) - x(from))}" height="${graphHeight}" fill="${phase === "working" ? "#382850" : "#1b2941"}" opacity="${phase === "working" ? "0.55" : "0.35"}"/><text x="${x(from) + 12}" y="${top + 24}" fill="${COLORS.muted}" font-size="14">${phase}</text>`).join("");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => `<line x1="${left}" y1="${y(maxY * fraction)}" x2="${width - right}" y2="${y(maxY * fraction)}" stroke="${COLORS.grid}"/><text x="${left - 14}" y="${y(maxY * fraction) + 5}" text-anchor="end" fill="${COLORS.muted}" font-size="14">${Math.round(maxY * fraction)} MiB</text>`).join("");
  const siteCards = groups.length ? groups.map((group, index) => { const complete = group.tasks.filter((task) => task.state === "completed").length; const failed = group.tasks.filter((task) => task.state === "failed").length; const promptCount = new Set(group.tasks.map((task) => task.prompt).filter(Boolean)).size; const promptLabel = promptCount === 1 ? "same prompt" : promptCount ? `${promptCount} prompts` : "prompt unavailable"; const lastFinishedAt = Math.max(...group.tasks.map((task) => finite(task.finishedAt) ? task.finishedAt : -Infinity)); const finishedLabel = Number.isFinite(lastFinishedAt) && finite(summary.runStartedAt) ? `last result +${formatSeconds((lastFinishedAt - summary.runStartedAt) / 1000)}` : "finish time unavailable"; const xPos = 70 + (index % 3) * 440; const yPos = 700 + Math.floor(index / 3) * 105; return `<g><rect x="${xPos}" y="${yPos}" width="405" height="90" rx="12" fill="${COLORS.panel}" stroke="${COLORS.grid}"/><text x="${xPos + 18}" y="${yPos + 27}" fill="${COLORS.text}" font-size="19" font-weight="700">${escapeXml(group.site)}</text><text x="${xPos + 18}" y="${yPos + 51}" fill="${COLORS.muted}" font-size="15">${group.tasks.length} tabs · ${complete} complete · ${failed} failed</text><text x="${xPos + 18}" y="${yPos + 73}" fill="${COLORS.muted}" font-size="14">${promptLabel} · ${finishedLabel}</text></g>`; }).join("") : `<text x="70" y="735" fill="${COLORS.muted}" font-size="18">Task metadata was not recorded for this run.</text>`;
  const unfinishedText = stats.pending + stats.unreported > 0 ? ` · ${stats.pending} unfinished · ${stats.unreported} unreported` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${COLORS.background}"/><text x="70" y="62" fill="${COLORS.text}" font-size="32" font-weight="700">${title}</text><text x="70" y="94" fill="${COLORS.muted}" font-size="17">${stats.total} parallel tabs · ${stats.completed} completed · ${stats.failed} failed${unfinishedText}</text>${syntheticLabel}<text x="${width - right}" y="62" text-anchor="end" fill="${COLORS.muted}" font-size="15">RSS · ${new Date(number(summary.runStartedAt, number(summary.startedAt, Date.now()))).toLocaleString()}</text><rect x="${left}" y="${top}" width="${graphWidth}" height="${graphHeight}" rx="10" fill="${COLORS.panel}"/>${bands}${grid}<path d="${linePath(samples, x, y, "chrome_rss_mib")}" fill="none" stroke="${COLORS.chrome}" stroke-width="4" stroke-linejoin="round"/><path d="${linePath(samples, x, y, "dsh_rss_mib")}" fill="none" stroke="${COLORS.dsh}" stroke-width="4" stroke-linejoin="round"/><text x="${left}" y="${top + graphHeight + 34}" fill="${COLORS.muted}" font-size="14">0s</text><text x="${width - right}" y="${top + graphHeight + 34}" text-anchor="end" fill="${COLORS.muted}" font-size="14">${maxX.toFixed(0)}s</text><text x="70" y="${top + graphHeight + 69}" fill="${COLORS.muted}" font-size="15">Peak +${formatMiB(summary.peakIncreaseMiB)} · Retained +${formatMiB(summary.retainedMiB)}</text><circle cx="${width - 320}" cy="${top + graphHeight + 63}" r="6" fill="${COLORS.chrome}"/><text x="${width - 305}" y="${top + graphHeight + 69}" fill="${COLORS.text}" font-size="15">Chrome</text><circle cx="${width - 190}" cy="${top + graphHeight + 63}" r="6" fill="${COLORS.dsh}"/><text x="${width - 175}" y="${top + graphHeight + 69}" fill="${COLORS.text}" font-size="15">DSH</text><text x="70" y="670" fill="${COLORS.text}" font-size="21" font-weight="700">Workload by site</text>${siteCards}<text x="70" y="${height - 18}" fill="${COLORS.muted}" font-size="13">RSS is aggregate process memory. Shared memory may be counted more than once; it is not per-tab attribution.</text></svg>`;
}

function timelineSvg(summary) {
  const groups = taskGroups(summary);
  const tasks = groups.flatMap((group) => group.tasks.map((task) => ({ ...task, site: group.site })));
  const rowHeight = 42;
  const headerHeight = 145;
  const width = 1440;
  const height = headerHeight + Math.max(1, tasks.length) * rowHeight + groups.length * 30 + 40;
  const left = 355;
  const graphRight = 980;
  const graphWidth = graphRight - left;
  const start = number(summary.runStartedAt, summary.startedAt);
  const taskOffsets = tasks.flatMap((task) => [task.startedAt, task.finishedAt]).filter(finite).map((timestamp) => Math.max(0, (timestamp - start) / 1000));
  const maxTime = taskOffsets.length ? Math.max(1, ...taskOffsets) : Math.max(1, number(summary.elapsedSeconds));
  const x = (seconds) => left + (number(seconds) / maxTime) * graphWidth;
  let rows = "";
  let row = 0;
  for (const group of groups) {
    rows += `<text x="32" y="${headerHeight + row * rowHeight + 20}" fill="${COLORS.text}" font-size="18" font-weight="700">${escapeXml(group.site)}</text>`;
    row++;
    for (const task of group.tasks) {
      const y = headerHeight + row * rowHeight;
      const started = finite(task.startedAt) ? (task.startedAt - start) / 1000 : null;
      const finished = finite(task.finishedAt) ? (task.finishedAt - start) / 1000 : null;
      const state = task.state === "completed" ? "complete" : task.state === "failed" ? "failed" : "pending";
      const barX = started === null ? left : x(Math.max(0, started));
      const barWidth = started !== null && finished !== null ? Math.max(4, x(Math.max(started, finished)) - barX) : 5;
      const detail = started === null ? task.state === "failed" && finished !== null ? `failed before starting · result +${formatSeconds(finished)}` : "timing unavailable" : finished === null ? "unfinished" : `${formatSeconds(finished - started)} duration · finished +${formatSeconds(finished)}`;
      rows += `<line x1="${left}" y1="${y + 14}" x2="${graphRight}" y2="${y + 14}" stroke="${COLORS.grid}" opacity="0.5"/><text x="50" y="${y + 20}" fill="${COLORS.muted}" font-size="15">tab ${escapeXml(task.tabId)}</text><text x="170" y="${y + 20}" fill="${COLORS.text}" font-size="15">${escapeXml(shortText(task.title || task.url || "untitled tab"))}</text><rect x="${barX}" y="${y + 3}" width="${barWidth}" height="22" rx="8" fill="${COLORS[state]}"/><text x="1010" y="${y + 20}" fill="${COLORS.muted}" font-size="14">${state} · ${detail}</text>`;
      row++;
    }
  }
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => `<line x1="${x(maxTime * fraction)}" y1="${headerHeight - 25}" x2="${x(maxTime * fraction)}" y2="${height - 25}" stroke="${COLORS.grid}" opacity="0.7"/><text x="${x(maxTime * fraction)}" y="${headerHeight - 35}" text-anchor="middle" fill="${COLORS.muted}" font-size="14">+${(maxTime * fraction).toFixed(0)}s</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${COLORS.background}"/><text x="32" y="45" fill="${COLORS.text}" font-size="28" font-weight="700">Task timeline</text><text x="32" y="76" fill="${COLORS.muted}" font-size="16">Each row is one tab. Bars include the agent request and response save.</text>${grid}${rows}</svg>`;
}

function htmlReport(summary, overview, timeline) {
  const groups = taskGroups(summary);
  const runStartedAt = finite(summary.runStartedAt) ? summary.runStartedAt : null;
  const taskRows = (summary.tasks ?? []).map((task) => { const finishedOffset = runStartedAt !== null && finite(task.finishedAt) ? formatSeconds((task.finishedAt - runStartedAt) / 1000) : "unavailable"; const finishedClock = finite(task.finishedAt) ? new Date(task.finishedAt).toLocaleTimeString() : "unavailable"; return `<tr><td>${escapeXml(task.site || "Unknown")}</td><td>${escapeXml(task.title || task.url || task.tabId)}</td><td>${escapeXml(task.state || "unreported")}</td><td>${finite(task.startedAt) && finite(task.finishedAt) ? formatSeconds((task.finishedAt - task.startedAt) / 1000) : "unavailable"}</td><td>${escapeXml(finishedOffset)} (${escapeXml(finishedClock)})</td><td>${escapeXml(task.error || "")}</td></tr>`; }).join("");
  const prompts = groups.map((group) => { const distinct = [...new Set(group.tasks.map((task) => task.prompt).filter(Boolean))]; return distinct.length ? `<details><summary>${escapeXml(group.site)} · ${distinct.length === 1 ? "same prompt on every tab" : `${distinct.length} prompts`}</summary>${distinct.map((prompt, index) => `<p>${distinct.length > 1 ? `<strong>Prompt ${index + 1}</strong><br>` : ""}${escapeXml(prompt)}</p>`).join("")}</details>` : ""; }).join("");
  return `<!doctype html><meta charset="utf-8"><title>DSH memory benchmark</title><style>body{margin:0;background:#080d19;color:#eef3ff;font:15px system-ui,sans-serif}main{max-width:1440px;margin:0 auto;padding:28px}h1{margin:0 0 6px}p,summary{color:#9ca9c5}img{display:block;max-width:100%;margin:18px 0;border:1px solid #2a3856;border-radius:12px}details{background:#141c31;border:1px solid #2a3856;border-radius:8px;padding:12px;margin:8px 0}details p{white-space:pre-wrap;line-height:1.5}table{border-collapse:collapse;width:100%;margin-top:18px;background:#141c31}th,td{text-align:left;padding:10px;border-bottom:1px solid #2a3856}th{color:#9ca9c5}</style><main><h1>DSH memory benchmark</h1><p>${summary.tabCount ?? "?"} parallel tabs · peak increase ${formatMiB(summary.peakIncreaseMiB)} · retained ${formatMiB(summary.retainedMiB)}</p><img src="memory-chart.png" alt="Memory usage and workload by site"><img src="task-timeline.png" alt="Task timeline grouped by site"><h2>Prompts</h2>${prompts || "<p>Prompt metadata was not recorded for this run.</p>"}<h2>Tasks</h2><table><thead><tr><th>Site</th><th>Tab</th><th>Outcome</th><th>Duration</th><th>Finished after run start</th><th>Error</th></tr></thead><tbody>${taskRows || "<tr><td colspan=6>Task metadata was not recorded for this run.</td></tr>"}</tbody></table><p>RSS is aggregate process memory. Shared memory may be counted more than once, and these values are not per-tab attribution.</p></main>`;
}

export function writeMemoryCharts(directory, summary, samples) {
  const overview = overviewSvg(summary, samples);
  const timeline = timelineSvg(summary);
  writeFileSync(join(directory, "memory-chart.svg"), overview);
  writeFileSync(join(directory, "task-timeline.svg"), timeline);
  writeFileSync(join(directory, "memory-chart.png"), new Resvg(overview).render().asPng());
  writeFileSync(join(directory, "task-timeline.png"), new Resvg(timeline).render().asPng());
  writeFileSync(join(directory, "report.html"), htmlReport(summary, overview, timeline));
}

export function renderReportDirectory(directory) {
  const summary = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
  const samples = parseSamples(readFileSync(join(directory, "samples.csv"), "utf8"));
  writeMemoryCharts(directory, summary, samples);
  return { summary, samples };
}

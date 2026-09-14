import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { openBenchmarkExtensions, setupInstructions } from "./benchmark-setup.mjs";

const PORT = Number(process.env.DSH_BENCHMARK_PORT ?? 7332);
const SAMPLE_INTERVAL_MS = 1000;
const COOLDOWN_MS = 60_000;
const profileDirectory = resolve(homedir(), ".dsh", "browser-agent-memory-profile");
const reportDirectory = resolve(`memory-reports/${new Date().toISOString().replace(/[:.]/g, "-")}`);
const extensionDirectory = resolve("extension/dist");

const samples = [];
let phase = "baseline";
let run;
let cooldownTimer;
let cooldownProgressTimer;
let cooldownStartedAt;
let cooldownComplete = false;
let sampleTimer;
let stopped = false;
let chromeDetected;
let extensionConnected = false;
let printedDshStatus;
let dshPid;

function runCommand(command, args) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function processRows() {
  if (process.platform === "win32") throw new Error("The guided benchmark currently supports macOS and Linux. Windows support can use the same report format with a PowerShell process adapter.");
  return runCommand("ps", ["-axo", "pid=,ppid=,rss=,args="]).trim().split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match && { pid: Number(match[1]), parent: Number(match[2]), rss: Number(match[3]), args: match[4] };
  }).filter(Boolean);
}

function processTree(rows, roots) {
  const ids = new Set(roots);
  let previousSize;
  do {
    previousSize = ids.size;
    for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid);
  } while (previousSize !== ids.size);
  return rows.filter((row) => ids.has(row.pid));
}

function findDshPid() {
  try {
    const output = runCommand("lsof", ["-nP", `-iTCP:7331`, "-sTCP:LISTEN", "-t"]).trim();
    const pid = Number(output.split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
}

function chromeRoots(rows) {
  const marker = `--user-data-dir=${profileDirectory}`;
  const roots = rows.filter((row) => row.args.includes(marker)).map((row) => row.pid);
  const detected = roots.length > 0;
  if (chromeDetected !== detected) {
    chromeDetected = detected;
    console.log(detected ? "  Chrome     Connected to test profile" : "  Chrome     Waiting for test window...");
  }
  return roots;
}

function mib(rows) {
  return rows.reduce((total, row) => total + row.rss, 0) / 1024;
}

function sample() {
  try {
    const rows = processRows();
    if (!dshPid || !rows.some((row) => row.pid === dshPid)) dshPid = findDshPid();
    if (printedDshStatus !== Boolean(dshPid)) {
      printedDshStatus = Boolean(dshPid);
      console.log(dshPid ? "  DSH        Running" : "  DSH        Not running. Start DSH to run tasks.");
    }
    const chrome = processTree(rows, chromeRoots(rows));
    const dsh = dshPid ? processTree(rows, [dshPid]).filter((row) => !chrome.some((candidate) => candidate.pid === row.pid)) : [];
    const chromeMiB = mib(chrome);
    const dshMiB = mib(dsh);
    const timestamp = new Date().toISOString();
    samples.push({ timestamp, elapsedSeconds: (Date.now() - startedAt) / 1000, phase, chromeMiB, dshMiB, totalMiB: chromeMiB + dshMiB, chromeProcesses: chrome.length, dshProcesses: dsh.length });
  } catch (error) {
    console.error(`Memory sample failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stopped) sampleTimer = setTimeout(sample, SAMPLE_INTERVAL_MS);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function statsFor(name) {
  const values = samples.filter((item) => item.phase === name).map((item) => item.totalMiB);
  return { samples: values.length, averageMiB: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, medianMiB: median(values), peakMiB: values.length ? Math.max(...values) : null, finalMiB: values.at(-1) ?? null };
}

function reportHtml(summary) {
  const phaseNames = ["baseline", "working", "cooldown"];
  const cards = phaseNames.map((name) => `<article><small>${name}</small><strong>${summary.phases[name].medianMiB === null ? "-" : `${summary.phases[name].medianMiB.toFixed(1)} MiB`}</strong><span>${summary.phases[name].samples} samples</span></article>`).join("");
  const rows = samples.map((item) => `<tr><td>${item.timestamp}</td><td>${item.phase}</td><td>${item.chromeMiB.toFixed(1)}</td><td>${item.dshMiB.toFixed(1)}</td><td>${item.totalMiB.toFixed(1)}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>dsh Browser Agent memory report</title><style>body{font:15px system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#172033}h1{margin-bottom:4px}p{color:#536174}.cards{display:flex;gap:12px;flex-wrap:wrap}.cards article{min-width:150px;padding:14px;border:1px solid #d8dee8;border-radius:10px}.cards small,.cards strong,.cards span{display:block}.cards strong{font-size:24px;margin:5px 0}.cards span{color:#7a8798;font-size:12px}table{border-collapse:collapse;width:100%;margin-top:24px;font-size:12px}td,th{padding:7px;border-bottom:1px solid #e8ecf2;text-align:left}code{background:#f1f3f7;padding:2px 4px;border-radius:4px}</style><h1>dsh Browser Agent memory report</h1><p>${summary.tabCount ? `${summary.tabCount} parallel task${summary.tabCount === 1 ? "" : "s"} measured.` : "No completed benchmark task was received."} RSS is an approximate process-memory metric; shared memory may be counted more than once.</p><div class="cards">${cards}</div><p><strong>Retained after cooldown:</strong> ${summary.retainedMiB === null ? "-" : `${summary.retainedMiB.toFixed(1)} MiB above baseline`}</p><table><thead><tr><th>Time</th><th>Phase</th><th>Chrome MiB</th><th>DSH MiB</th><th>Total MiB</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function saveReport(error) {
  mkdirSync(reportDirectory, { recursive: true });
  const baseline = statsFor("baseline");
  const working = statsFor("working");
  const cooldown = statsFor("cooldown");
  const summary = { metric: "Summed process RSS in MiB", profileDirectory, dshPid: dshPid ?? null, tabCount: run?.tabCount ?? null, runId: run?.runId ?? null, sampleCount: samples.length, elapsedSeconds: (Date.now() - startedAt) / 1000, cooldownComplete, cooldownSeconds: cooldownStartedAt ? (Date.now() - cooldownStartedAt) / 1000 : 0, phases: { baseline, working, cooldown }, peakIncreaseMiB: baseline.medianMiB !== null && working.peakMiB !== null ? working.peakMiB - baseline.medianMiB : null, retainedMiB: cooldownComplete && baseline.medianMiB !== null && cooldown.medianMiB !== null ? cooldown.medianMiB - baseline.medianMiB : null, error: error ? String(error) : null };
  writeFileSync(join(reportDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(reportDirectory, "report.html"), reportHtml(summary));
  writeFileSync(join(reportDirectory, "summary.md"), [
    "# dsh Browser Agent memory report",
    "",
    `Parallel tasks: ${summary.tabCount ?? "none"}`,
    `Samples: ${summary.sampleCount}`,
    `Peak increase: ${summary.peakIncreaseMiB === null ? "unavailable" : `${summary.peakIncreaseMiB.toFixed(1)} MiB`}`,
    `Retained after cooldown: ${summary.retainedMiB === null ? "unavailable" : `${summary.retainedMiB.toFixed(1)} MiB`}`,
    "",
    "RSS is an approximate process-memory metric. Shared memory may be counted more than once.",
    "",
  ].join("\n"));
  writeFileSync(join(reportDirectory, "samples.csv"), "timestamp,elapsed_seconds,phase,chrome_rss_mib,dsh_rss_mib,total_rss_mib,chrome_processes,dsh_processes\n");
  for (const item of samples) appendFileSync(join(reportDirectory, "samples.csv"), `${item.timestamp},${item.elapsedSeconds.toFixed(3)},${item.phase},${item.chromeMiB.toFixed(3)},${item.dshMiB.toFixed(3)},${item.totalMiB.toFixed(3)},${item.chromeProcesses},${item.dshProcesses}\n`);
  console.log(`\nReport saved to ${reportDirectory}`);
  console.log(`Peak increase: ${summary.peakIncreaseMiB === null ? "unavailable" : `${summary.peakIncreaseMiB.toFixed(1)} MiB`}`);
  console.log(`Retained after cooldown: ${summary.retainedMiB === null ? "unavailable" : `${summary.retainedMiB.toFixed(1)} MiB`}`);
}

async function launchChrome() {
  mkdirSync(profileDirectory, { recursive: true });
  const opened = await openBenchmarkExtensions(profileDirectory);
  console.log(opened
    ? "  Opening extension manager in the test profile..."
    : "  Could not open Chrome. Install Google Chrome, then type extensions to retry.");
}

function markExtensionConnected() {
  if (extensionConnected) return;
  extensionConnected = true;
  console.log("  Extension  Connected. Choose Memory test in the side panel.");
}

function onEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") return;
  if (event.type === "extension_ready") {
    markExtensionConnected();
  } else if (event.type === "panel_opened") {
    markExtensionConnected();
    console.log(`  Tabs       ${event.tabCount} web tab${event.tabCount === 1 ? "" : "s"} available`);
  } else if (event.type === "run_started") {
    if (run || stopped) throw new Error("This recorder already has a run.");
    if (typeof event.runId !== "string" || !Number.isInteger(event.tabCount) || event.tabCount < 1) throw new Error("Invalid run.");
    run = event;
    phase = "working";
    console.log(`\n  Working    ${event.tabCount} parallel task${event.tabCount === 1 ? "" : "s"}`);
    console.log(`  Run        ${event.runId}`);
  } else if (event.type === "run_settled") {
    if (!run || event.runId !== run.runId || event.tabCount !== run.tabCount || phase !== "working") throw new Error("Run does not match the recorder.");
    phase = "cooldown";
    cooldownStartedAt = Date.now();
    console.log("\n  Cooldown   Tasks finished. Leave tabs open for 60 seconds.");
    clearTimeout(cooldownTimer);
    cooldownProgressTimer = setInterval(() => {
      console.log(`  Cooldown   ${Math.max(0, Math.ceil((COOLDOWN_MS - (Date.now() - cooldownStartedAt)) / 1000))}s remaining`);
    }, 15_000);
    cooldownTimer = setTimeout(() => { cooldownComplete = true; finish(); }, COOLDOWN_MS);
  }
}

const server = createServer((request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS" && request.url === "/events") {
    response.writeHead(204, { "access-control-allow-origin": origin ?? "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" });
    response.end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/events") { response.writeHead(404); response.end(); return; }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; if (body.length > 100_000) request.destroy(); });
  request.on("end", () => {
    try { onEvent(JSON.parse(body)); response.writeHead(204, { "access-control-allow-origin": origin ?? "*" }); response.end(); }
    catch { response.writeHead(400); response.end(); }
  });
});
server.on("error", (error) => {
  console.error(`Could not start the benchmark event server on port ${PORT}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  finish(error);
});

function finish(error) {
  if (stopped) return;
  stopped = true;
  clearTimeout(sampleTimer);
  clearTimeout(cooldownTimer);
  clearInterval(cooldownProgressTimer);
  server.close();
  saveReport(error);
  input.close();
  process.stdin.pause();
}

const startedAt = Date.now();
if (!["darwin", "linux"].includes(process.platform)) {
  console.error("Memory benchmark currently supports macOS and Linux.");
  process.exit(1);
}
console.log("\n  dsh · Memory test\n");
if (process.env.DSH_BENCHMARK_SKIP_BUILD !== "1") {
  console.log("  Building extension...");
  try {
    execFileSync("pnpm", ["run", "build"], { stdio: "pipe", timeout: 120_000 });
    console.log("  Extension built.");
  } catch (error) {
    console.error("\n  Build failed. Fix the error below, then run pnpm benchmark:memory again.\n");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
    process.exit(1);
  }
}
mkdirSync(reportDirectory, { recursive: true });
server.listen(PORT, "127.0.0.1", () => {
  console.log("  Using a separate Chrome profile for this test.");
  console.log(setupInstructions(extensionDirectory));
  if (process.env.DSH_BENCHMARK_NO_LAUNCH !== "1") void launchChrome();
  console.log("  Extension  Waiting. Follow the setup steps above.");
  sample();
});

const input = createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  const command = line.trim().toLowerCase();
  if (command === "stop") finish("Stopped by user");
  else if (command === "extensions") void launchChrome();
  else if (command === "help") console.log(setupInstructions(extensionDirectory));
  else if (command === "status") {
    const last = samples.at(-1);
    console.log(`\n  Chrome     ${chromeDetected ? "Connected" : "Waiting for test window"}`);
    console.log(`  Extension  ${extensionConnected ? "Seen by this runner" : "Waiting. Type help for setup."}`);
    console.log(`  DSH        ${dshPid ? "Running" : "Not detected"}`);
    console.log(`  Phase      ${phase}`);
    console.log(`  Memory     ${last?.chromeProcesses ? `${last.chromeMiB.toFixed(0)} MiB Chrome` : "Chrome unavailable"} · ${last?.dshProcesses ? `${last.dshMiB.toFixed(0)} MiB DSH` : "DSH unavailable"}\n`);
  } else if (command) console.log("  Commands: extensions · status · help · stop");
});
process.once("SIGINT", () => finish());
process.once("SIGTERM", () => finish());

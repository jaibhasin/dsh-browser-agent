import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createServer } from "node:net";
import { openBenchmarkExtensions, setupInstructions } from "../evals/memory-benchmark/benchmark-setup.mjs";

test("setup explains the complete manual installation and recovery", () => {
  const text = setupInstructions("/project with spaces/extension/dist");
  for (const step of ["chrome://extensions", "Developer mode", "Load unpacked", "/project with spaces/extension/dist", "Reload", "Extensions menu", "extensions", "status", "stop"]) {
    assert.ok(text.includes(step), `Missing setup step: ${step}`);
  }
});

test("macOS opens the manager with an isolated profile on every launch", async () => {
  const calls = [];
  const spawnProcess = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await openBenchmarkExtensions("/profile with spaces", { platform: "darwin", spawnProcess }), true);
  }
  for (const call of calls) {
    assert.equal(call.command, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    assert.ok(call.args.includes("--user-data-dir=/profile with spaces"));
    assert.ok(call.args.includes("--no-first-run"));
    assert.equal(call.args.at(-1), "chrome://extensions/");
  }
});

test("launcher handles asynchronous missing-browser errors and tries the next candidate", async () => {
  const calls = [];
  const spawnProcess = (command) => {
    calls.push(command);
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => calls.length === 1 ? child.emit("error", new Error("ENOENT")) : child.emit("spawn"));
    return child;
  };
  assert.equal(await openBenchmarkExtensions("/profile", { platform: "linux", spawnProcess }), true);
  assert.deepEqual(calls, ["google-chrome", "google-chrome-stable"]);
});

test("missing Chrome returns a recoverable failure", async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  assert.equal(await openBenchmarkExtensions("/profile", { platform: "linux", spawnProcess }), false);
});

test("terminal displays setup, answers status, and saves on stop", { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "dsh-benchmark-cli-"));
  const child = spawn(process.execPath, [resolve("evals/memory-benchmark/benchmark-memory.mjs")], {
    cwd: directory,
    env: { ...process.env, DSH_BENCHMARK_SKIP_BUILD: "1", DSH_BENCHMARK_NO_LAUNCH: "1", DSH_BENCHMARK_PORT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  let sent = false;
  child.stdout.on("data", (data) => {
    output += data;
    if (!sent && output.includes("Follow the setup steps above.")) {
      sent = true;
      child.stdin.end("status\nstop\n");
    }
  });
  child.stderr.on("data", (data) => { errors += data; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, errors);
    assert.match(output, /Developer mode/);
    assert.match(output, /Load unpacked/);
    assert.match(output, /Phase\s+baseline/);
    assert.match(output, /Memory\s+/);
    const reportPath = output.match(/Report saved to (.+)/)?.[1];
    assert.ok(reportPath);
    const summary = JSON.parse(readFileSync(join(reportPath, "summary.json"), "utf8"));
    assert.equal(summary.tabCount, null);
    assert.equal(summary.peakIncreaseMiB, null);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
});

test("recorder keeps the three-task run and rejects unrelated cooldown events", { timeout: 15_000 }, async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const directory = mkdtempSync(join(tmpdir(), "dsh-benchmark-run-"));
  const child = spawn(process.execPath, [resolve("evals/memory-benchmark/benchmark-memory.mjs")], {
    cwd: directory,
    env: { ...process.env, DSH_BENCHMARK_SKIP_BUILD: "1", DSH_BENCHMARK_NO_LAUNCH: "1", DSH_BENCHMARK_PORT: String(port) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output += data;
      if (output.includes("Follow the setup steps above.")) resolve();
    });
    child.once("error", reject);
    child.once("exit", () => reject(new Error(errors || "Recorder exited during startup")));
  });
  child.stderr.on("data", (data) => { errors += data; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const post = (event) => fetch(`http://127.0.0.1:${port}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
  try {
    await ready;
    assert.equal((await post({ type: "run_started", runId: "three-tabs", tabCount: 3 })).status, 204);
    assert.equal((await post({ type: "run_started", runId: "one-tab", tabCount: 1 })).status, 400);
    assert.equal((await post({ type: "run_settled", runId: "one-tab", tabCount: 1 })).status, 400);
    assert.equal((await post({ type: "run_settled", runId: "three-tabs", tabCount: 3 })).status, 204);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(child.exitCode, null, "Cooldown must not finish in 1-2 seconds");
    child.stdin.end("stop\n");
    assert.equal(await exited, 0, errors);
    const reportPath = output.match(/Report saved to (.+)/)?.[1];
    const summary = JSON.parse(readFileSync(join(reportPath, "summary.json"), "utf8"));
    assert.equal(summary.tabCount, 3);
    assert.equal(summary.runId, "three-tabs");
    assert.equal(summary.cooldownComplete, false);
    assert.equal(summary.retainedMiB, null);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
});

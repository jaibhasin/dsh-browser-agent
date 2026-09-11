import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const help = `Usage: pnpm measure:memory [--duration seconds] [--interval seconds] [--port 7331] [--dsh-pid PID] [--chrome-pid PID] [--out directory]

macOS/Linux process RSS sampler. Start Chrome and DSH first.
Type a phase label and Enter while recording: baseline, working-5-tabs, cooldown.
Press Ctrl+C to save the summary. Default duration: until stopped.
Chrome defaults to all Google Chrome processes; --chrome-pid selects one process tree.
RSS includes shared pages and is an approximate process-memory metric, not JS heap.
No browser actions are automated and no page content or process arguments are saved.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); return; }
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('This sampler supports macOS and Linux.');
  const options = { duration: 0, interval: 1, port: 7331 };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!['duration', 'interval', 'port', 'dsh-pid', 'chrome-pid', 'out'].includes(key) || !args[i].startsWith('--') || !args[i + 1]) throw new Error(help);
    options[key] = key === 'out' ? args[i + 1] : Number(args[i + 1]);
    if (key !== 'out' && (!Number.isFinite(options[key]) || options[key] <= 0)) throw new Error(`Invalid --${key}`);
    if (['port', 'dsh-pid', 'chrome-pid'].includes(key) && !Number.isInteger(options[key])) throw new Error(`Invalid --${key}`);
  }
  const run = (command, argv) => execFileSync(command, argv, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  function processes() {
    return run('ps', ['-axo', 'pid=,ppid=,rss=,comm=']).trim().split('\n').map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      return match && { pid: +match[1], parent: +match[2], rss: +match[3], name: match[4] };
    }).filter(Boolean);
  }
  function tree(rows, roots) {
    const ids = new Set(roots);
    let size;
    do {
      size = ids.size;
      for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid);
    } while (size !== ids.size);
    return rows.filter(row => ids.has(row.pid));
  }
  let dshPid = options['dsh-pid'];
  if (!dshPid) {
    let pids;
    try { pids = [...new Set(run('lsof', ['-nP', `-iTCP:${options.port}`, '-sTCP:LISTEN', '-t']).trim().split(/\s+/).map(Number))]; }
    catch { throw new Error(`Cannot find the DSH listener on port ${options.port}. Start DSH, or pass --dsh-pid PID (requires lsof for auto-detection).`); }
    if (pids.length !== 1 || !pids[0]) throw new Error('Expected one DSH listener. Pass --dsh-pid PID.');
    dshPid = pids[0];
  }
  const first = processes();
  if (!first.some(row => row.pid === dshPid)) throw new Error('DSH PID is not running.');
  const chromeRoots = options['chrome-pid'] ? [options['chrome-pid']] : first.filter(row => /Google Chrome|\/google-chrome(?:-stable)?$|\/chrome$/.test(row.name)).map(row => row.pid);
  if (!tree(first, chromeRoots).length) throw new Error('Chrome was not found. Start Chrome or pass --chrome-pid PID.');
  const directory = resolve(options.out ?? `memory-reports/${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(directory, { recursive: true });
  const csv = resolve(directory, 'samples.csv');
  writeFileSync(csv, 'timestamp,elapsed_seconds,phase,chrome_rss_mib,dsh_rss_mib,total_rss_mib,chrome_processes,dsh_processes\n', { flag: 'wx' });
  const phases = new Map();
  let phase = 'baseline';
  let count = 0;
  let peak = 0;
  let initial;
  let last;
  let timer;
  let stopped = false;
  const started = Date.now();
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', line => { if (line.trim()) { phase = line.trim(); console.log(`Phase: ${phase}`); } });
  function finish(error) {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    input.close();
    process.stdin.pause();
    const summary = { metric: 'Summed process RSS in MiB; shared memory may be counted more than once.', scope: 'Chrome process tree(s) and DSH listener process tree. No per-tab attribution.', dshPid, chromeRoots, samples: count, elapsedSeconds: (Date.now() - started) / 1000, initialTotalMiB: initial, peakTotalMiB: peak, finalTotalMiB: last, finalMinusInitialMiB: last === undefined ? null : last - initial, phases: Object.fromEntries([...phases].map(([name, value]) => [name, { samples: value.count, averageTotalMiB: value.sum / value.count, peakTotalMiB: value.peak, finalTotalMiB: value.last }])), error: error?.message ?? null };
    writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(`\nSaved ${count} samples to ${directory}\nPeak total RSS: ${peak.toFixed(1)} MiB`);
    if (error) { console.error(error.message); process.exitCode = 1; }
  }
  process.once('SIGINT', () => finish());
  process.once('SIGTERM', () => finish());
  console.log(`Recording to ${directory}\nDSH PID: ${dshPid}. Type a phase label and Enter; Ctrl+C finishes.\n${help.split('\n').slice(-3).join('\n')}`);
  function sample() {
    try {
      const rows = processes();
      if (!rows.some(row => row.pid === dshPid)) throw new Error('DSH exited; restart the measurement after restarting DSH.');
      const chrome = tree(rows, chromeRoots);
      if (!chrome.length) throw new Error('Chrome exited; recording stopped.');
      const chromeIds = new Set(chrome.map(row => row.pid));
      const dsh = tree(rows, [dshPid]).filter(row => !chromeIds.has(row.pid));
      const rss = group => group.reduce((sum, row) => sum + row.rss, 0) / 1024;
      const c = rss(chrome), d = rss(dsh), total = c + d;
      initial ??= total;
      last = total;
      peak = Math.max(peak, total);
      count++;
      const stats = phases.get(phase) ?? { count: 0, sum: 0, peak: 0 };
      stats.count++; stats.sum += total; stats.peak = Math.max(stats.peak, total); stats.last = total;
      phases.set(phase, stats);
      const elapsed = (Date.now() - started) / 1000;
      appendFileSync(csv, `${new Date().toISOString()},${elapsed.toFixed(3)},"${phase.replaceAll('"', '""')}",${c.toFixed(3)},${d.toFixed(3)},${total.toFixed(3)},${chrome.length},${dsh.length}\n`);
      if (options.duration && elapsed >= options.duration) finish();
      else timer = setTimeout(sample, options.interval * 1000);
    } catch (error) { finish(error); }
  }
  sample();
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }

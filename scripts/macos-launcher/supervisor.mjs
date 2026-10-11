import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function portInUse(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(800, () => finish(true));
  });
}

export function authenticateBridge(WebSocket, { bridgePort, extensionId, token }) {
  return new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${bridgePort}`, {
      headers: { origin: `chrome-extension://${extensionId}` }, handshakeTimeout: 1200,
    });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 1500);
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'hello', protocolVersion: 2, token, client: 'chrome-extension', clientId: randomUUID(),
    })));
    socket.once('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        finish(message.type === 'welcome' && message.protocolVersion === 2);
      } catch { finish(false); }
    });
  });
}

export class Supervisor {
  constructor(config, WebSocket, report) {
    this.config = config;
    this.WebSocket = WebSocket;
    this.report = report;
    this.state = 'stopped';
  }
  publish(state, message, ready = false) {
    this.state = state;
    this.report({ state, message, ready, settingsURL: `http://127.0.0.1:${this.config.webPort}` });
  }
  async start() {
    if (this.child || this.state === 'starting' || this.stopping) return;
    this.publish('starting', 'Starting your browser agent...');
    try {
      for (const port of [this.config.bridgePort, this.config.webPort]) {
        if (await portInUse(port)) throw new Error(`Port ${port} is already in use. Quit the other DSH instance, then try again.`);
      }
      if (this.state !== 'starting') return;
      mkdirSync(dirname(this.config.logPath), { recursive: true, mode: 0o700 });
      if (existsSync(this.config.logPath) && statSync(this.config.logPath).size > 5 * 1024 * 1024) {
        renameSync(this.config.logPath, this.config.logPath + '.previous');
      }
      const log = openSync(this.config.logPath, 'a', 0o600);
      try {
        this.child = spawn(process.execPath, [this.config.startPath], {
          cwd: dirname(this.config.startPath), detached: true,
          env: { ...process.env, DSH_HOME: this.config.dshHome, NO_COLOR: '1' },
          stdio: ['ignore', log, log],
        });
      } finally { closeSync(log); }
      const child = this.child;
      child.on('error', () => {
        if (!this.stopping) this.publish('error', 'The agent could not start. Open the logs for details.');
      });
      child.on('exit', () => {
        if (!this.stopping && this.child === child) {
          this.killGroup(child.pid, 'SIGKILL');
          this.child = undefined;
          this.publish('error', 'The agent stopped unexpectedly. Open the logs, then try again.');
        }
      });
      const deadline = Date.now() + (this.config.startTimeoutMs ?? 45000);
      while (this.child === child && !this.stopping && Date.now() < deadline) {
        if (await this.healthy()) {
          if (this.child !== child || this.stopping) return;
          this.publish('ready', 'Open the extension in Chrome. Your agent is ready.', true);
          this.monitor = setInterval(() => void this.checkHealth(), 4000);
          return;
        }
        await delay(300);
      }
      if (this.child === child && !this.stopping) {
        await this.stop();
        this.publish('error', 'Startup took too long. Open the logs, then try again.');
      }
    } catch (error) {
      if (this.child) await this.stop();
      this.publish('error', error.message);
    }
  }
  async healthy() {
    const [bridge, web] = await Promise.all([
      authenticateBridge(this.WebSocket, this.config),
      fetch(`http://127.0.0.1:${this.config.webPort}`, { signal: AbortSignal.timeout(1500), redirect: 'manual' })
        .then(response => { void response.body?.cancel(); return response.status >= 200 && response.status < 400; }).catch(() => false),
    ]);
    return bridge && web;
  }
  async checkHealth() {
    if (this.checking || !this.child || this.stopping) return;
    this.checking = true;
    const child = this.child;
    try {
      const ready = await this.healthy();
      if (this.child !== child || this.stopping) return;
      if (ready && this.state !== 'ready') this.publish('ready', 'Open the extension in Chrome. Your agent is ready.', true);
      if (!ready && this.state !== 'error') this.publish('error', 'The agent connection needs attention. Stop and start it again.');
    } finally { this.checking = false; }
  }
  killGroup(pid, signal) {
    if (!pid) return;
    try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.publish('stopping', 'Stopping your browser agent...');
    clearInterval(this.monitor);
    this.stopping = (async () => {
      const child = this.child;
      if (child?.pid) {
        const exited = new Promise(resolve => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once('exit', resolve);
        });
        this.killGroup(child.pid, 'SIGTERM');
        await Promise.race([exited, delay(2500)]);
        this.killGroup(child.pid, 'SIGKILL');
        await exited;
      }
      this.child = undefined;
      this.publish('stopped', 'Start the agent whenever you need it.');
    })();
    try { await this.stopping; } finally { this.stopping = undefined; }
  }
}

async function main() {
  const report = status => process.stdout.write(`${JSON.stringify(status)}\n`);
  let supervisor;
  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    await supervisor?.stop();
    process.exit(0);
  };
  process.on('SIGTERM', quit);
  process.on('SIGINT', quit);
  process.stdin.on('end', quit);
  process.stdout.on('error', quit);
  try {
    const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const profile = join(config.dshHome, 'profiles', 'dsh-browser-agent');
    const require = createRequire(join(profile, 'package.json'));
    const { WebSocket } = require('ws');
    const { parse } = require('yaml');
    const base = parse(readFileSync(join(profile, 'cordis.yml'), 'utf8')) || [];
    const patches = parse(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')) || [];
    const bundle = [...base, ...patches].filter(item => item.id === 'dsh-browser-agent').reduce((all, item) => ({ ...all, ...item.config }), {});
    const web = [...base, ...patches].filter(item => item.id === 'webserver').reduce((all, item) => ({ ...all, ...item.config }), {});
    const token = readFileSync(join(profile, '.bridge-token'), 'utf8').trim();
    if (!existsSync(config.startPath) || !/^[a-p]{32}$/.test(bundle.extensionId) || token.length < 32) throw new Error('Incomplete installation');
    supervisor = new Supervisor({ ...config, token, extensionId: bundle.extensionId, bridgePort: bundle.port ?? 7331, webPort: web.port ?? 3080 }, WebSocket, report);
    const input = createInterface({ input: process.stdin });
    input.on('line', command => {
      if (quitting) return;
      if (command === 'start') void supervisor.start();
      if (command === 'stop') void supervisor.stop();
      if (command === 'quit') void quit();
    });
    if (!quitting) await supervisor.start();
  } catch {
    report({ state: 'error', ready: false, message: 'The installed agent is missing or incomplete. Run the project installer, then reopen this app.' });
    createInterface({ input: process.stdin }).on('line', command => { if (command === 'quit') void quit(); });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();

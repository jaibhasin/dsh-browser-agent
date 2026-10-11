import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { authenticateBridge, portInUse, Supervisor } from '../scripts/macos-launcher/supervisor.mjs';

const require = createRequire(resolve('dsh-plugin/package.json'));
const { WebSocket } = require('ws');
const token = 'a'.repeat(64);
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const supervisorPath = resolve('scripts/macos-launcher/supervisor.mjs');

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(condition, diagnostics = () => '') {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await delay(50);
  }
  assert.fail(`Condition did not become true: ${diagnostics()}`);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function fixture(run, { unresponsive = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'browser agent launcher '));
  const config = {
    dshHome: home, startPath: join(home, 'start.mjs'), logPath: join(home, 'logs', 'agent.log'),
    token, extensionId, bridgePort: await freePort(), webPort: await freePort(), startTimeoutMs: 1500,
  };
  const wsPath = require.resolve('ws');
  writeFileSync(config.startPath, `
import { createRequire } from 'node:module';
const { WebSocketServer } = createRequire(import.meta.url)(${JSON.stringify(wsPath)});
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
writeFileSync(${JSON.stringify(join(home, 'pids.json'))}, JSON.stringify([process.pid, grandchild.pid]));
console.log('http://127.0.0.1:${config.webPort}/?token=fixture-web-token');
process.on('SIGTERM', () => {});
const bridge = new WebSocketServer({ host: '127.0.0.1', port: ${config.bridgePort}, verifyClient: info => info.origin === 'chrome-extension://${extensionId}' });
bridge.on('connection', socket => socket.on('message', raw => {
  const hello = JSON.parse(raw.toString());
  if (hello.token === '${token}' && hello.protocolVersion === 2 && !${unresponsive}) socket.send(JSON.stringify({ type: 'welcome', protocolVersion: 2 }));
  else socket.close(1008);
}));
createServer((_req, res) => { res.statusCode = 401; res.end('DSH authentication required'); }).listen(${config.webPort}, '127.0.0.1');
`);
  let supervisor;
  try {
    supervisor = new Supervisor(config, WebSocket, () => {});
    await run({ config, supervisor, home });
  } finally {
    await supervisor?.stop();
    rmSync(home, { recursive: true, force: true });
  }
}

test('authenticates readiness, rejects wrong tokens, and stops the complete process group', { timeout: 15000 }, () => fixture(async ({ config, supervisor, home }) => {
  mkdirSync(join(home, 'logs'));
  writeFileSync(config.logPath, 'http://127.0.0.1:3080/?token=expired-token\n');
  await supervisor.start();
  assert.equal(supervisor.state, 'ready', existsSync(config.logPath) ? readFileSync(config.logPath, 'utf8') : 'Missing agent log');
  assert.equal(supervisor.settingsURL, `http://127.0.0.1:${config.webPort}/?token=fixture-web-token`);
  const pids = JSON.parse(readFileSync(join(home, 'pids.json')));
  assert.ok(pids.every(alive));
  assert.equal(await authenticateBridge(WebSocket, { ...config, token: 'b'.repeat(64) }), false);
  const firstChild = supervisor.child;
  await supervisor.start();
  assert.equal(supervisor.child, firstChild, 'Repeated start must reuse the existing process');
  await Promise.all([supervisor.stop(), supervisor.stop()]);
  assert.equal(supervisor.state, 'stopped');
  await until(() => pids.every(pid => !alive(pid)));
  assert.equal(await portInUse(config.bridgePort), false);
  assert.equal(await portInUse(config.webPort), false);
  await supervisor.start();
  assert.equal(supervisor.state, 'ready', 'Start after stop must work');
}));

test('does not take over or terminate an unrelated server', { timeout: 10000 }, () => fixture(async ({ config, supervisor }) => {
  const server = createServer();
  server.listen(config.bridgePort, '127.0.0.1');
  await once(server, 'listening');
  try {
    await supervisor.start();
    assert.equal(supervisor.state, 'error');
    assert.equal(supervisor.child, undefined);
    await supervisor.stop();
    assert.equal(await portInUse(config.bridgePort), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test('a bridge that cannot authenticate never becomes ready and is cleaned up', { timeout: 10000 }, () => fixture(async ({ config, supervisor }) => {
  await supervisor.start();
  assert.equal(supervisor.state, 'error');
  assert.equal(supervisor.child, undefined);
  assert.equal(await portInUse(config.bridgePort), false);
  assert.equal(await portInUse(config.webPort), false);
}, { unresponsive: true }));

test('closing the app control pipe cleans up a running agent', { timeout: 15000 }, () => fixture(async ({ config, home }) => {
  const profile = join(home, 'profiles', 'dsh-browser-agent');
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  writeFileSync(join(profile, 'package.json'), '{}');
  symlinkSync(resolve('dsh-plugin/node_modules/ws'), join(profile, 'node_modules', 'ws'));
  symlinkSync(resolve('node_modules/yaml'), join(profile, 'node_modules', 'yaml'));
  writeFileSync(join(profile, '.bridge-token'), token);
  writeFileSync(join(profile, 'cordis.yml'), '[]');
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: dsh-browser-agent\n  config:\n    extensionId: ${extensionId}\n    port: ${config.bridgePort}\n- id: webserver\n  config:\n    port: ${config.webPort}\n`);
  const configPath = join(home, 'launcher.json');
  writeFileSync(configPath, JSON.stringify(config));
  const processHandle = spawn(process.execPath, [supervisorPath, configPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  processHandle.stdout.on('data', data => { output += data; });
  try {
    await until(() => output.includes('"state":"ready"'), () => output + (existsSync(config.logPath) ? readFileSync(config.logPath, 'utf8') : ''));
    const pids = JSON.parse(readFileSync(join(home, 'pids.json')));
    const exit = once(processHandle, 'exit');
    processHandle.stdin.end();
    await exit;
    await until(() => pids.every(pid => !alive(pid)));
    assert.equal(await portInUse(config.bridgePort), false);
    assert.equal(await portInUse(config.webPort), false);
  } finally {
    if (processHandle.exitCode === null) {
      const exit = once(processHandle, 'exit');
      processHandle.kill('SIGTERM');
      await exit;
    }
  }
}));

test('a missing runtime produces an actionable error without leaking configuration', { timeout: 10000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'launcher missing install '));
  const configPath = join(home, 'launcher.json');
  writeFileSync(configPath, JSON.stringify({ dshHome: home }));
  const child = spawn(process.execPath, [supervisorPath, configPath]);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  try {
    await until(() => output.includes('"state":"error"'));
    assert.match(output, /Run the project installer/);
    assert.equal(output.includes(home), false);
    const exit = once(child, 'exit');
    child.stdin.write('quit\n');
    await exit;
  } finally {
    if (child.exitCode === null) child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});

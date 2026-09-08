import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

// Opt-in network test: installs real dependencies and boots DSH without an API key.
test('fresh install, profile startup, update, and recoverable uninstall', { skip: process.env.DSH_INSTALL_E2E !== '1', timeout: 900_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh installer e2e '));
  const env = { ...process.env, DSH_HOME: home };
  const installer = resolve('scripts/install.mjs');
  const profile = join(home, 'profiles', 'browser-agent-installed');
  const root = join(home, 'browser-agent-install');
  let child;
  let socket;
  try {
    const install = (...args) => {
      const result = spawnSync(process.execPath, [installer, ...args], { env, encoding: 'utf8', timeout: 600_000 });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };
    const output = install();
    assert.match(output, /Developer mode/);
    assert.match(output, /Load unpacked/);
    const token = readFileSync(join(profile, '.bridge-token'), 'utf8');
    const originalManifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
    assert.equal(originalManifest.dsh.profile.bundles.at(-1), '@jaibhasin/dsh-browser-agent');
    // Use an available bridge port and an ephemeral web port, avoiding other DSH installs.
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const patchPath = join(profile, 'cordis.patch.yml');
    const patch = readFileSync(patchPath, 'utf8').replace('port: 7331', `port: ${port}`) + '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n';
    writeFileSync(patchPath, patch);
    install();
    assert.equal(readFileSync(join(profile, '.bridge-token'), 'utf8'), token);
    assert.equal(readFileSync(patchPath, 'utf8'), patch);
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
    assert.notEqual(manifest.dependencies['@jaibhasin/dsh-browser-agent'], originalManifest.dependencies['@jaibhasin/dsh-browser-agent']);
    const require = createRequire(join(profile, 'package.json'));
    const { WebSocket } = require('ws');
    child = spawn(process.execPath, [join(root, 'start.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.stdout.on('data', data => { logs += data; });
    child.stderr.on('data', data => { logs += data; });
    let authenticated = false;
    for (let attempt = 0; attempt < 100 && !authenticated; attempt++) {
      assert.equal(child.exitCode, null, logs);
      authenticated = await new Promise(resolve => {
        socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: 'chrome-extension://abcdefghijklmnop' } });
        const timer = setTimeout(() => { socket.terminate(); resolve(false); }, 2000);
        socket.on('error', () => { clearTimeout(timer); resolve(false); });
        socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, token: token.trim(), client: 'chrome-extension' })));
        socket.once('message', raw => { clearTimeout(timer); resolve(JSON.parse(raw).type === 'welcome'); });
      });
      if (!authenticated) await delay(200);
    }
    assert.ok(authenticated, 'The installed bridge did not become ready.');
    const response = once(socket, 'message', { signal: AbortSignal.timeout(10_000) });
    socket.send(JSON.stringify({ type: 'new_session', id: 'installer-smoke' }));
    const [raw] = await response;
    const message = JSON.parse(raw);
    assert.equal(message.type, 'new_session_response');
    assert.equal(message.error, undefined);
    socket.close();
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
    child = undefined;
    install('--uninstall');
    assert.ok(readdirSync(home).some(name => name.startsWith('browser-agent-install.uninstalled-')));
    assert.ok(readdirSync(join(home, 'profiles')).some(name => name.startsWith('browser-agent-installed.uninstalled-')));
  } finally {
    socket?.terminate();
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

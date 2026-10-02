import assert from 'node:assert/strict';
import { spawn as spawnProcess, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { test } from 'node:test';
import { openChromeExtensionsPage } from '../scripts/open-chrome-extensions.mjs';
import { installerWorkspaceFilters } from '../scripts/install.mjs';

const installer = resolve('scripts/install.mjs');
const supportedDshVersion = '0.1.6-alpha.2';
test('runtime lock contains only the supported DSH release, including projection cache', () => {
  const manifest = JSON.parse(readFileSync('runtime/package.json', 'utf8'));
  const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const pluginManifest = JSON.parse(readFileSync('dsh-plugin/package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('runtime/package-lock.json', 'utf8'));
  const packages = Object.entries(lock.packages).filter(([path]) => /node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path));
  assert.ok(packages.length > 0);
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], supportedDshVersion);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-attachment'], supportedDshVersion);
  assert.equal(lock.packages[''].dependencies['@deepseek-ai/dsh'], supportedDshVersion);
  for (const [path, pkg] of packages) assert.equal(pkg.version, supportedDshVersion, path);
  for (const [name, version] of Object.entries(pluginManifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, `^${supportedDshVersion}`, name);
  }
  for (const [name, version] of Object.entries(pluginManifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, supportedDshVersion, name);
  }
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-session-projection-cache'].version, supportedDshVersion);
  assert.ok(!lock.packages['node_modules/@deepseek-ai/dsh-host-apiproxy']);
});

test('installer excludes report-only workspace dependencies', () => {
  const rootManifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const pluginManifest = JSON.parse(readFileSync('dsh-plugin/package.json', 'utf8'));
  assert.deepEqual(installerWorkspaceFilters, [rootManifest.name, pluginManifest.name]);
  assert.deepEqual(installerWorkspaceFilters, ['dsh-browser-agent', '@jaibhasin/dsh-browser-agent']);
});

test('opens the Chrome extensions page using the platform browser launcher', () => {
  const calls = [];
  const spawn = (command, argv) => {
    calls.push([command, argv]);
    return { unref() {} };
  };
  assert.equal(openChromeExtensionsPage({ platform: 'darwin', env: {}, spawn }), true);
  assert.deepEqual(calls[0], ['open', ['-a', 'Google Chrome', 'chrome://extensions']]);
});

test('skips the Chrome launcher in CI', () => {
  let called = false;
  const spawn = () => {
    called = true;
    return { unref() {} };
  };
  assert.equal(openChromeExtensionsPage({ platform: 'darwin', env: { CI: 'true' }, spawn }), false);
  assert.equal(called, false);
});

test('detaches a live browser launcher without waiting for it', () => {
  const liveChild = spawnProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
  const originalUnref = liveChild.unref.bind(liveChild);
  let unrefCalled = false;
  let launchOptions;
  liveChild.unref = () => {
    unrefCalled = true;
    return originalUnref();
  };
  const startedAt = performance.now();
  try {
    assert.equal(openChromeExtensionsPage({
      platform: 'darwin',
      env: {},
      spawn: (_command, _argv, options) => {
        launchOptions = options;
        return liveChild;
      },
    }), true);
    assert.ok(performance.now() - startedAt < 1_000);
    assert.deepEqual(launchOptions, { stdio: 'ignore', detached: true });
    assert.equal(unrefCalled, true);
  } finally {
    liveChild.kill();
  }
});
function fixture(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-install-test-'));
  try { fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
function invoke(home, ...args) {
  return spawnSync(process.execPath, [installer, ...args], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8',
  });
}

test('refuses an existing unmanaged profile without changing it', () => fixture(home => {
  const profile = join(home, 'profiles', 'dsh-browser-agent');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'package.json'), '{"private":true}');
  const result = invoke(home);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(profile, 'package.json'), 'utf8'), '{"private":true}');
  assert.deepEqual(readdirSync(home), ['profiles']);
}));

test('a failed dependency download leaves no unmanaged profile and permits retry', { skip: process.platform === 'win32' }, () => fixture(home => {
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 17\n', { mode: 0o700 });
  const profile = join(home, 'profiles', 'dsh-browser-agent');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, [installer], {
      env: { ...process.env, DSH_HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}` }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm failed: 17/);
    assert.doesNotMatch(result.stderr, /unmanaged/);
    assert.equal(existsSync(profile), false);
    assert.equal(existsSync(join(home, 'dsh-browser-agent', '.install-lock')), false);
  }
}));

test('uninstall archives owned files and leaves other profiles intact', () => fixture(home => {
  for (const path of ['dsh-browser-agent', 'profiles/dsh-browser-agent']) {
    mkdirSync(join(home, path), { recursive: true });
    writeFileSync(join(home, path, '.installer-owner'), 'jaibhasin/dsh-browser-agent:1');
    writeFileSync(join(home, path, 'user-data'), 'keep me');
  }
  mkdirSync(join(home, 'profiles', 'web'));
  const result = invoke(home, '--uninstall');
  assert.equal(result.status, 0, result.stderr);
  const backup = readdirSync(home).find(name => name.startsWith('dsh-browser-agent.uninstalled-'));
  assert.equal(readFileSync(join(home, backup, 'user-data'), 'utf8'), 'keep me');
  assert.ok(readdirSync(join(home, 'profiles')).includes('web'));
  assert.equal(invoke(home, '--uninstall').status, 0);
}));

test('uninstall validates both targets before moving either', () => fixture(home => {
  const root = join(home, 'dsh-browser-agent');
  mkdirSync(root);
  writeFileSync(join(root, '.installer-owner'), 'jaibhasin/dsh-browser-agent:1');
  mkdirSync(join(home, 'profiles', 'dsh-browser-agent'), { recursive: true });
  assert.equal(invoke(home, '--uninstall').status, 1);
  assert.ok(readdirSync(home).includes('dsh-browser-agent'));
}));

test('migrates the legacy installation directory before uninstalling', () => fixture(home => {
  const legacyRoot = join(home, 'browser-agent-install');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, '.installer-owner'), 'jaibhasin/dsh-browser-agent:1');
  const result = invoke(home, '--uninstall');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readdirSync(home).some(name => name.startsWith('dsh-browser-agent.uninstalled-')));
}));

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../extension/background/browser-snapshot.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { captureBrowserScreenshot } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const tab = { id: 7, windowId: 3, active: true };
function setup({ annotationError, captureError, switched = false } = {}) {
  const calls = [];
  globalThis.chrome = {
    scripting: { async executeScript() { calls.push('inject'); } },
    tabs: {
      async get(id) { assert.equal(id, tab.id); return { ...tab, active: !switched }; },
      async sendMessage(id, { type }) {
        assert.equal(id, tab.id);
        calls.push(type);
        return annotationError ? { error: annotationError } : { ok: true };
      },
      async captureVisibleTab(windowId) {
        assert.equal(windowId, tab.windowId);
        calls.push('capture');
        if (captureError) throw new Error(captureError);
        return 'data:image/png;base64,cG5n';
      },
    },
  };
  return calls;
}

test('plain screenshots do not inject or annotate the page', async () => {
  const calls = setup();
  assert.deepEqual(await captureBrowserScreenshot(tab), { data: 'cG5n', mediaType: 'image/png' });
  assert.deepEqual(calls, ['capture']);
});
test('annotation is painted before capture and cleaned afterward', async () => {
  const calls = setup();
  await captureBrowserScreenshot(tab, true);
  assert.deepEqual(calls, ['inject', 'dsh-browser-annotate', 'capture', 'dsh-browser-clear-annotations']);
});
test('capture failure cleans the overlay and releases the tab for a retry', async () => {
  const calls = setup({ captureError: 'capture failed' });
  await assert.rejects(captureBrowserScreenshot(tab, true), /capture failed/);
  assert.equal(calls.at(-1), 'dsh-browser-clear-annotations');
  setup();
  await captureBrowserScreenshot(tab, true);
});
test('missing snapshot fails explicitly without capturing and still cleans', async () => {
  const calls = setup({ annotationError: 'Take a browser_snapshot first' });
  await assert.rejects(captureBrowserScreenshot(tab, true), /browser_snapshot/);
  assert.ok(!calls.includes('capture'));
  assert.equal(calls.at(-1), 'dsh-browser-clear-annotations');
});
test('switching tabs while painting prevents capture and cleans the overlay', async () => {
  const calls = setup({ switched: true });
  await assert.rejects(captureBrowserScreenshot(tab, true), /remain visible/);
  assert.ok(!calls.includes('capture'));
  assert.equal(calls.at(-1), 'dsh-browser-clear-annotations');
});
test('a switch during capture rejects the result and cleans the overlay', async () => {
  const calls = setup();
  const capture = chrome.tabs.captureVisibleTab;
  chrome.tabs.captureVisibleTab = async (...args) => {
    const image = await capture(...args);
    chrome.tabs.get = async () => ({ ...tab, active: false });
    return image;
  };
  await assert.rejects(captureBrowserScreenshot(tab, true), /changed during screenshot/);
  assert.equal(calls.at(-1), 'dsh-browser-clear-annotations');
});
test('a second screenshot cannot capture an in-progress overlay', async () => {
  setup();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (...args) => {
    if (args[1].type === 'dsh-browser-annotate') { started(); await pending; }
    return send(...args);
  };
  const first = captureBrowserScreenshot(tab, true);
  await entered;
  await assert.rejects(captureBrowserScreenshot(tab), /already being captured/);
  release();
  await first;
});

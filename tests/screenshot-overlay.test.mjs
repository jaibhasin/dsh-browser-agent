import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import ts from 'typescript';

// Set CHROMIUM_BIN to exercise the content script in a real browser.
test('overlay uses snapshot refs, clips to the viewport, and preserves page controls', {
  skip: !process.env.CHROMIUM_BIN,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-overlay-'));
  try {
    const source = await readFile(new URL('../extension/content/snapshot.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const fixture = `<!doctype html><body>
      <button id="search" style="position:absolute;left:100px;top:80px">Search</button>
      <button id="offscreen" style="position:absolute;top:5000px">Offscreen</button>
      <button id="partial" style="position:absolute;left:-10px;top:200px;width:100px">Partial</button>
      <div id="component"></div><pre id="result">pending</pre>
      <script>
      const roots = new Map();
      const originalAttach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = originalAttach.call(this, options); roots.set(this, root); return root; };
      document.querySelector('#component').attachShadow({mode:'open'}).innerHTML = '<button style="position:absolute;left:300px;top:100px">Shadow button</button>';
      let listener;
      globalThis.chrome = {runtime: {onMessage: {addListener(fn) { listener = fn; }}}};
      ${compiled}
      const send = (type, args = {}) => new Promise(resolve => listener({type, ...args}, {}, resolve));
      const check = (value, message) => { if (!value) throw new Error(message); };
      (async () => {
        const missing = await send('dsh-browser-annotate');
        check(missing.error?.includes('browser_snapshot'), 'missing snapshot did not fail');
        const snapshot = await send('dsh-browser-snapshot');
        const refFor = name => Object.entries(snapshot.refs).find(([, metadata]) => metadata.name === name)?.[0];
        const searchRef = refFor('Search'), offscreenRef = refFor('Offscreen'), shadowRef = refFor('Shadow button');
        check(searchRef && offscreenRef && shadowRef, 'fixture refs missing');
        const beforeStyle = document.querySelector('#search').getAttribute('style');
        check((await send('dsh-browser-annotate')).ok, 'annotation failed');
        const overlay = contentScriptState.__dshBrowserAnnotationOverlay;
        const root = roots.get(overlay);
        const labels = [...root.querySelectorAll('.label')].map(element => element.textContent);
        check(labels.includes('[' + searchRef + ']'), 'search label missing');
        check(labels.includes('[' + shadowRef + ']'), 'shadow label missing');
        check(!labels.includes('[' + offscreenRef + ']'), 'offscreen label drawn');
        const rect = document.querySelector('#search').getBoundingClientRect();
        const boxes = [...root.querySelectorAll('.box')];
        check(boxes.some(box => parseFloat(box.style.left) === rect.left && parseFloat(box.style.top) === rect.top && parseFloat(box.style.width) === rect.width), 'box coordinates incorrect');
        check(boxes.every(box => parseFloat(box.style.left) >= 0), 'partial box not clipped');
        check(getComputedStyle(overlay).pointerEvents === 'none', 'overlay intercepts input');
        check(document.elementFromPoint(rect.left + 5, rect.top + 5)?.id === 'search', 'overlay changed hit testing');
        check(overlay.shadowRoot === null, 'overlay shadow root is not closed');
        check(document.querySelector('#search').getAttribute('style') === beforeStyle, 'page styles changed');
        const during = await send('dsh-browser-snapshot');
        check(during.fingerprint === snapshot.fingerprint && JSON.stringify(during.refs) === JSON.stringify(snapshot.refs), 'overlay contaminated snapshot');
        await send('dsh-browser-clear-annotations');
        check(!overlay.isConnected, 'overlay was not removed');
        let clicked = false;
        document.querySelector('#search').onclick = () => { clicked = true; };
        check((await send('dsh-browser-click', {ref: Number(searchRef)})).ok && clicked, 'snapshot ref lost');
        document.querySelector('#result').textContent = 'Overlay regression passed';
      })().catch(error => { document.querySelector('#result').textContent = 'FAILED: ' + error.message; });
      </script>`;
    const path = join(temp, 'fixture.html');
    await writeFile(path, fixture);
    const output = execFileSync(process.env.CHROMIUM_BIN, [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--no-first-run', '--disable-background-networking', '--disable-extensions',
      '--disable-component-update', '--no-proxy-server', '--timeout=10000',
      '--window-size=800,600', '--virtual-time-budget=2500', '--dump-dom',
      `--user-data-dir=${join(temp, 'profile')}`, `file://${path}`,
    ], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    assert.equal(result, 'Overlay regression passed');
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
});

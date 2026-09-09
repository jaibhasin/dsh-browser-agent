import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Run against a real Chromium page using the browse test driver.
// BROWSE_BIN must point to the installed browse executable.
assert.ok(process.env.BROWSE_BIN, "Set BROWSE_BIN to the browse executable");
const temp = await mkdtemp(join(tmpdir(), "dsh-shadow-test-"));
const browse = (...args) => execFileSync(process.env.BROWSE_BIN, args, { encoding: "utf8", env: {...process.env, BROWSE_STATE_FILE: join(temp, 'browser.json')} });
try {
  const source = await readFile(new URL("../extension/content/snapshot.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  await writeFile(join(temp, "fixture.html"), '<!doctype html><title>Shadow controls test</title><body><h1>New post</h1><post-editor></post-editor></body>');
  browse("goto", `file://${join(temp, "fixture.html")}`);
  const script = `(() => {
    const host = document.querySelector('post-editor');
    host.style.display = 'block';
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = '<span id="label">Post title</span><textarea aria-labelledby="label"></textarea><nested-editor></nested-editor><slot></slot>';
    const nested = root.querySelector('nested-editor').attachShadow({mode: 'open'});
    nested.innerHTML = '<button>Preview post</button>';
    host.innerHTML = '<button>Slotted control</button>';
    let clicked = false, receivedInput = false, listener;
    nested.querySelector('button').addEventListener('click', () => { clicked = true; });
    host.addEventListener('input', () => { receivedInput = true; });
    globalThis.chrome = {runtime: {onMessage: {addListener(fn) { listener = fn; }}}};
    ${compiled}
    const send = (type, args = {}) => { let result; listener({type, ...args}, {}, value => { result = value; }); return result; };
    const snapshot = send('dsh-browser-snapshot').text;
    const ref = name => Number(snapshot.match(new RegExp('\\\\[(\\\\d+)\\\\] [^\\\\n]*"' + name + '"'))?.[1]);
    const titleRef = ref('Post title'), buttonRef = ref('Preview post');
    if (!titleRef || !buttonRef) throw new Error('Missing shadow control refs: ' + snapshot);
    if (!send('dsh-browser-type', {ref: titleRef, text: 'A title'}).typed) throw new Error('Typing failed');
    if (root.querySelector('textarea').value !== 'A title' || !receivedInput) throw new Error('Input did not reach component');
    if (!send('dsh-browser-click', {ref: buttonRef}).ok || !clicked) throw new Error('Click failed');
    if ((snapshot.match(/\\[\\d+\\] button "Slotted control"/g) || []).length !== 1) throw new Error('Duplicate slotted ref');
    host.setAttribute('aria-hidden', 'true');
    if (send('dsh-browser-click', {ref: buttonRef}).ok) throw new Error('Hidden host allowed click');
    if (send('dsh-browser-type', {ref: titleRef, text: 'Hidden'}).typed) throw new Error('Hidden host allowed typing');
    if (send('dsh-browser-snapshot').text.includes('Post title')) throw new Error('Hidden host leaked controls');
    return 'Shadow DOM regression passed';
  })()`;
  await writeFile(join(temp, "check.js"), script);
  const output = browse("eval", join(temp, "check.js"));
  assert.match(output, /Shadow DOM regression passed/);
  console.log(output);
} finally {
  try { browse("stop"); } catch {}
  await rm(temp, {recursive: true, force: true});
}

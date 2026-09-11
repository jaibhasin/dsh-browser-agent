import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedBenchmarkTabs, toggleBenchmarkTab } from "../shared/benchmark-selection.ts";

test("all selection picks up websites opened after an empty panel", () => {
  assert.deepEqual(selectedBenchmarkTabs([], null), []);
  const tabs = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(selectedBenchmarkTabs(tabs, null), tabs);
});

test("individual choices persist, select all restores every available tab", () => {
  const tabs = [{ id: 1 }, { id: 2 }];
  const selected = toggleBenchmarkTab(tabs, null, 1);
  assert.deepEqual(selectedBenchmarkTabs(tabs, selected), [{ id: 2 }]);
  assert.deepEqual(selectedBenchmarkTabs([...tabs, { id: 3 }], selected), [{ id: 2 }]);
  assert.deepEqual(selectedBenchmarkTabs(tabs, new Set()), []);
  assert.deepEqual(selectedBenchmarkTabs(tabs, null), tabs);
});

test("closed tabs are never included in the run selection", () => {
  assert.deepEqual(selectedBenchmarkTabs([{ id: 2 }], new Set([1, 2])), [{ id: 2 }]);
});

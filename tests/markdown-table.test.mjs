import assert from "node:assert/strict";
import test from "node:test";
import { isMarkdownTableStart, readMarkdownTable } from "../extension/sidepanel/src/markdown-table.ts";

test("parses a markdown table and preserves alignment", () => {
  const lines = [
    "| Model | Price | Notes |",
    "| :--- | ---: | :---: |",
    "| V4 \\| Flash | $0.17 | **listed** |",
    "",
    "After the table",
  ];

  assert.equal(isMarkdownTableStart(lines, 0), true);
  assert.deepEqual(readMarkdownTable(lines, 0), {
    headers: ["Model", "Price", "Notes"],
    alignments: ["left", "right", "center"],
    rows: [["V4 | Flash", "$0.17", "**listed**"]],
    nextIndex: 3,
  });
  assert.equal(isMarkdownTableStart(lines, 3), false);
});

test("does not mistake pipe-delimited prose for a table", () => {
  assert.equal(isMarkdownTableStart(["A | sentence", "still | prose"], 0), false);
});

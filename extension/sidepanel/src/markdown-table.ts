export type TableAlignment = "left" | "center" | "right";

export type MarkdownTable = {
  headers: string[];
  alignments: Array<TableAlignment | undefined>;
  rows: string[][];
  nextIndex: number;
};

export function readMarkdownTable(lines: string[], startIndex: number): MarkdownTable | undefined {
  const header = parseTableRow(lines[startIndex]);
  const separator = parseTableRow(lines[startIndex + 1]);
  if (!header || !separator || separator.cells.length !== header.cells.length || !separator.cells.every(isSeparatorCell)) {
    return undefined;
  }

  const alignments = separator.cells.map(getAlignment);
  const rows: string[][] = [];
  const columnCount = header.cells.length;
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const row = parseTableRow(lines[nextIndex]);
    if (!row) break;
    rows.push(normalizeRow(row.cells, columnCount));
    nextIndex += 1;
  }

  return { headers: normalizeRow(header.cells, columnCount), alignments, rows, nextIndex };
}

export function isMarkdownTableStart(lines: string[], index: number): boolean {
  return readMarkdownTable(lines, index) !== undefined;
}

function parseTableRow(line: string | undefined): { cells: string[] } | undefined {
  if (line === undefined) return undefined;
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return undefined;

  let content = trimmed;
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|") && !content.endsWith("\\|")) content = content.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\" && content[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.length >= 2 ? { cells } : undefined;
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell);
}

function getAlignment(cell: string): TableAlignment | undefined {
  const startsWithColon = cell.startsWith(":");
  const endsWithColon = cell.endsWith(":");
  if (startsWithColon && endsWithColon) return "center";
  if (endsWithColon) return "right";
  return startsWithColon ? "left" : undefined;
}

function normalizeRow(cells: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");
}

import { Fragment, type ElementType, type ReactNode } from "react";

type ListItem = { content: string; ordered: boolean };

export function MarkdownMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^\s]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="markdown-code" key={blocks.length}>
          <code data-language={fence[1] || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = `h${level}` as ElementType;
      blocks.push(<Heading className="markdown-heading" key={blocks.length}>{renderInline(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr className="markdown-rule" key={blocks.length} />);
      index += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith("> ")) {
        quote.push(lines[index].slice(2));
        index += 1;
      }
      blocks.push(<blockquote className="markdown-quote" key={blocks.length}>{renderInline(quote.join(" "))}</blockquote>);
      continue;
    }

    const list = readList(lines, index);
    if (list) {
      const List = list.items[0].ordered ? "ol" : "ul";
      blocks.push(
        <List className="markdown-list" key={blocks.length}>
          {list.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item.content)}</li>)}
        </List>,
      );
      index = list.nextIndex;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p className="markdown-paragraph" key={blocks.length}>{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="markdown-message">{blocks}</div>;
}

function readList(lines: string[], startIndex: number): { items: ListItem[]; nextIndex: number } | undefined {
  const first = parseListItem(lines[startIndex]);
  if (!first) return undefined;

  const items: ListItem[] = [first];
  let index = startIndex + 1;
  while (index < lines.length) {
    const item = parseListItem(lines[index]);
    if (!item || item.ordered !== first.ordered) break;
    items.push(item);
    index += 1;
  }
  return { items, nextIndex: index };
}

function parseListItem(line: string): ListItem | undefined {
  const match = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
  if (!match) return undefined;
  return { ordered: Boolean(match[2]), content: match[3] };
}

function isBlockStart(line: string): boolean {
  return /^```|^#{1,6}\s|^\s{0,3}([-*_])(?:\s*\1){2,}\s*$|^> |^\s*(?:[-+*]|\d+\.)\s+/.test(line);
}

function renderInline(value: string): ReactNode[] {
  const tokens = /(`[^`]*`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokens.exec(value))) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
    const token = match[0];
    const key = `inline-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(<code className="markdown-inline-code" key={key}>{token.slice(1, -1)}</code>);
    } else if (match[2] !== undefined) {
      nodes.push(safeLink(match[2], match[3], key));
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={key}>{renderInline(token.slice(2, -2))}</del>);
    } else {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1))}</em>);
    }
    lastIndex = tokens.lastIndex;
  }
  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes.map((node, index) => typeof node === "string" ? <Fragment key={`text-${index}`}>{node}</Fragment> : node);
}

function safeLink(label: string, url: string, key: string): ReactNode {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return <a href={parsed.href} key={key} target="_blank" rel="noreferrer">{renderInline(label)}</a>;
    }
  } catch {
    // The text below is rendered as text, rather than as an unsafe link.
  }
  return <Fragment key={key}>{`[${label}](${url})`}</Fragment>;
}

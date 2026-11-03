import { tkOpeningAt, type TKOpening } from "./parser";

const BREAKING_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DETAILS",
  "DIV",
  "DL",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

const SKIPPED_TAGS = new Set([
  "A",
  "CODE",
  "KBD",
  "MATH",
  "PRE",
  "SAMP",
  "SCRIPT",
  "STYLE",
  "SVG",
  "VAR",
]);

const SKIPPED_SELECTOR =
  ".tk-chip, .math, .frontmatter, .metadata-container, .internal-embed, .mermaid";

interface Walk {
  visibility?: boolean[];
  seen: number;
}

interface Close {
  node: Text;
  offset: number;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isReal(walk: Walk): boolean {
  const real = walk.visibility?.[walk.seen] ?? true;
  walk.seen++;
  return real;
}

function findClose(start: Text, from: number): Close | null {
  let depth = 1;
  let node: ChildNode | null = start;
  let offset = from;
  while (node) {
    if (isText(node)) {
      const data = node.data;
      for (let i = offset; i < data.length; i++) {
        const c = data[i];
        if (c === "\n") return null;
        if (c === "[") depth++;
        if (c === "]" && --depth === 0) return { node, offset: i };
      }
    } else if (
      isElement(node) &&
      BREAKING_TAGS.has(node.tagName.toUpperCase())
    ) {
      return null;
    }
    node = node.nextSibling;
    offset = 0;
  }
  return null;
}

function piece(doc: Document, className: string, text: string): HTMLElement {
  const span = doc.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function wrap(start: Text, index: number, close: Close, opening: TKOpening): HTMLElement {
  const doc = start.ownerDocument;
  const closing = close.node.splitText(close.offset);
  closing.splitText(1);
  const first = index > 0 ? start.splitText(index) : start;

  const chip = doc.createElement("span");
  chip.className = "tk-chip";
  first.parentNode?.insertBefore(chip, first);
  let node: ChildNode | null = first;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    chip.appendChild(node);
    if (node === closing) break;
    node = next;
  }

  const label = first.splitText(1);
  const rest = label.splitText(opening === "bare" ? 2 : 3);
  chip.replaceChild(piece(doc, "tk-bracket", "["), first);
  chip.replaceChild(piece(doc, "tk-label", label.data), label);
  chip.replaceChild(piece(doc, "tk-bracket", "]"), closing);
  chip.childNodes.forEach((child) => {
    if (isText(child) && child.data === "") child.remove();
  });
  if (rest.data === "") rest.remove();
  return chip;
}

function scanText(start: Text, walk: Walk): ChildNode | null {
  let node = start;
  let position = 0;
  for (;;) {
    const index = node.data.indexOf("[TK", position);
    if (index === -1) return node.nextSibling;

    const opening = tkOpeningAt(node.data, index);
    const close: Close | null =
      opening === "bare"
        ? { node, offset: index + 3 }
        : opening === "body"
          ? findClose(node, index + 4)
          : null;
    if (!opening || !close) {
      position = index + 3;
      continue;
    }

    if (!isReal(walk)) {
      node = close.node;
      position = close.offset + 1;
      continue;
    }

    const after = wrap(node, index, close, opening).nextSibling;
    if (!after || !isText(after)) return after;
    node = after;
    position = 0;
  }
}

function emptyLinkOpening(link: Element): TKOpening | null {
  const href = link.getAttribute("href");
  if (href !== null && href !== "" && href !== "#") return null;
  const first = link.firstChild;
  if (!first || !isText(first)) return null;
  if (first.data.startsWith("TK:")) return "body";
  return link.textContent === "TK" ? "bare" : null;
}

function replaceEmptyLink(link: Element, opening: TKOpening): HTMLElement {
  const doc = link.ownerDocument;
  const chip = doc.createElement("span");
  chip.className = "tk-chip";
  const first = link.firstChild as Text;
  const rest = first.splitText(opening === "bare" ? 2 : 3);

  chip.appendChild(piece(doc, "tk-bracket", "["));
  chip.appendChild(piece(doc, "tk-label", first.data));
  first.remove();
  if (rest.data === "") rest.remove();
  while (link.firstChild) chip.appendChild(link.firstChild);
  chip.appendChild(piece(doc, "tk-bracket", "]"));
  link.replaceWith(chip);
  return chip;
}

function isSkipped(element: Element): boolean {
  return (
    SKIPPED_TAGS.has(element.tagName.toUpperCase()) ||
    element.matches(SKIPPED_SELECTOR)
  );
}

function walkChildren(container: Element, walk: Walk): void {
  let node = container.firstChild;
  while (node) {
    if (isText(node)) {
      node = scanText(node, walk);
      continue;
    }
    if (isElement(node)) {
      const tag = node.tagName.toUpperCase();
      const opening = tag === "A" ? emptyLinkOpening(node) : null;
      if (opening) {
        const element: Element = node;
        node = isReal(walk)
          ? replaceEmptyLink(element, opening).nextSibling
          : element.nextSibling;
        continue;
      }
      if (!isSkipped(node)) walkChildren(node, walk);
    }
    node = node.nextSibling;
  }
}

export function decorateTKs(root: Element, visibility?: boolean[]): void {
  if (!isSkipped(root)) walkChildren(root, { visibility, seen: 0 });
}

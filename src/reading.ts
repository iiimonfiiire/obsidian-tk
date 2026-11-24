import {
  RESPONSE_SEPARATOR,
  openingLength,
  tkOpeningAt,
  type TKOpening,
} from "./parser";

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
  splitResponses: boolean;
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

function piece(className: string, text: string): HTMLElement {
  const span = createSpan();
  span.className = className;
  span.textContent = text;
  return span;
}

function chipClass(opening: TKOpening): string {
  return opening === "accepted" || opening === "rejected"
    ? `tk-chip tk-${opening}`
    : "tk-chip";
}

function wrap(start: Text, index: number, close: Close, opening: TKOpening): HTMLElement {
  const closing = close.node.splitText(close.offset);
  closing.splitText(1);
  const first = index > 0 ? start.splitText(index) : start;

  const chip = createSpan();
  chip.className = chipClass(opening);
  first.parentNode?.insertBefore(chip, first);
  let node: ChildNode | null = first;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    chip.appendChild(node);
    if (node === closing) break;
    node = next;
  }

  const label = first.splitText(1);
  const rest = label.splitText(openingLength(opening) - 1);
  chip.replaceChild(piece("tk-bracket", "["), first);
  chip.replaceChild(piece("tk-label", label.data), label);
  chip.replaceChild(piece("tk-bracket", "]"), closing);
  chip.childNodes.forEach((child) => {
    if (isText(child) && child.data === "") child.remove();
  });
  if (rest.data === "") rest.remove();
  return chip;
}

/**
 * Links are opaque elements here, so their contents don't count. The
 * closing bracket moves into the segment so it takes the pill's right end.
 */
function markResponse(chip: HTMLElement): void {
  let depth = 0;
  for (const node of Array.from(chip.childNodes)) {
    if (!isText(node)) continue;
    for (let i = 0; i < node.data.length; i++) {
      const c = node.data[i];
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (depth === 0 && node.data.startsWith(RESPONSE_SEPARATOR, i)) {
        const marker = node.splitText(i + 1);
        const rest = marker.splitText(2);
        chip.replaceChild(piece("tk-separator", ">>"), marker);

        const moved: ChildNode[] = [];
        for (let n: ChildNode | null = rest; n; n = n.nextSibling) moved.push(n);
        const closing = moved[moved.length - 1];
        const hasResponse = moved.some(
          (n) => n !== closing && (n.textContent ?? "").trim() !== "",
        );
        if (hasResponse) {
          const segment = createSpan();
          segment.className = "tk-response";
          chip.insertBefore(segment, rest);
          moved.forEach((n) => segment.appendChild(n));
        }
        if (rest.data === "" && rest.parentNode) rest.remove();
        if (node.data === "") node.remove();
        return;
      }
    }
  }
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
        : opening
          ? findClose(node, index + openingLength(opening))
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

    const chip = wrap(node, index, close, opening);
    if (walk.splitResponses) markResponse(chip);
    const after = chip.nextSibling;
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
  if (first.data.startsWith("TK accepted:")) return "accepted";
  if (first.data.startsWith("TK rejected:")) return "rejected";
  return link.textContent === "TK" ? "bare" : null;
}

function replaceEmptyLink(
  link: Element,
  opening: TKOpening,
  splitResponses: boolean,
): HTMLElement {
  const chip = createSpan();
  chip.className = chipClass(opening);
  const first = link.firstChild as Text;
  const rest = first.splitText(openingLength(opening) - 1);

  chip.appendChild(piece("tk-bracket", "["));
  chip.appendChild(piece("tk-label", first.data));
  first.remove();
  if (rest.data === "") rest.remove();
  while (link.firstChild) chip.appendChild(link.firstChild);
  chip.appendChild(piece("tk-bracket", "]"));
  link.replaceWith(chip);
  if (splitResponses) markResponse(chip);
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
          ? replaceEmptyLink(element, opening, walk.splitResponses).nextSibling
          : element.nextSibling;
        continue;
      }
      if (!isSkipped(node)) walkChildren(node, walk);
    }
    node = node.nextSibling;
  }
}

export interface DecorateOptions {
  visibility?: boolean[];
  /** Off when the source has `\\>`, which renders as a plain `>` here. */
  splitResponses?: boolean;
}

export function decorateTKs(
  root: Element,
  { visibility, splitResponses = true }: DecorateOptions = {},
): void {
  if (isSkipped(root)) return;
  walkChildren(root, { visibility, splitResponses, seen: 0 });
}

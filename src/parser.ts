export interface TK {
  start: number;
  end: number;
  line: number;
  ch: number;
  body: string;
  /** Absolute offset of the first top-level " >> ", or null. */
  separator: number | null;
  /** Text after the separator. Null when there is none or nothing follows it. */
  response: string | null;
  responseStart: number | null;
  responseEnd: number | null;
  bare: boolean;
  raw: string;
  inFrontmatter: boolean;
}

interface Candidate {
  start: number;
  end: number;
  escaped: boolean;
}

export type TKOpening = "bare" | "body";

const FENCE_OPEN =
  /^([ \t]*(?:>[ \t]*)*)(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[ \t]*$/;
const INLINE_LINK_TAIL =
  /^\((?:<[^<>]+>|[^\s()<>]+)(?:[ \t]+(?:"[^"]*"|'[^']*'))?[ \t]*\)/;

export function tkOpeningAt(text: string, index: number): TKOpening | null {
  if (!text.startsWith("[TK", index)) return null;
  const next = text[index + 3];
  if (next === "]") return "bare";
  if (next === ":") return "body";
  return null;
}

function backtickRunLength(line: string, index: number): number {
  let end = index;
  while (line[end] === "`") end++;
  return end - index;
}

function closingBacktickRun(
  line: string,
  from: number,
  length: number,
  unmatched: Set<number>,
): number {
  if (unmatched.has(length)) return -1;
  let i = line.indexOf("`", from);
  while (i !== -1) {
    const run = backtickRunLength(line, i);
    if (run === length) return i;
    i = line.indexOf("`", i + run);
  }
  unmatched.add(length);
  return -1;
}

function closingBracket(
  line: string,
  from: number,
  unmatched: Set<number>,
): number {
  let depth = 1;
  let i = from;
  while (i < line.length) {
    const c = line[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "`") {
      const run = backtickRunLength(line, i);
      const close = closingBacktickRun(line, i + run, run, unmatched);
      i = close === -1 ? i + run : close + run;
    } else {
      if (c === "[") depth++;
      if (c === "]" && --depth === 0) return i;
      i++;
    }
  }
  return -1;
}

function wikilinkEnd(line: string, index: number): number {
  const close = line.indexOf("]]", index + 2);
  if (close === -1) return -1;
  const inner = line.slice(index + 2, close);
  return inner.includes("[") || inner.includes("]") ? -1 : close + 2;
}

function tkEnd(line: string, index: number, unmatched: Set<number>): number {
  const opening = tkOpeningAt(line, index);
  if (opening === "bare") return index + 4;
  if (opening === "body") {
    const close = closingBracket(line, index + 4, unmatched);
    return close === -1 ? -1 : close + 1;
  }
  return -1;
}

function scanLine(line: string, offset: number, out: Candidate[]): void {
  const unmatched = new Set<number>();
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "\\") {
      const end = line[i + 1] === "[" ? tkEnd(line, i + 1, unmatched) : -1;
      if (end !== -1) {
        out.push({ start: offset + i + 1, end: offset + end, escaped: true });
        i = end;
      } else {
        i += 2;
      }
    } else if (c === "`") {
      const run = backtickRunLength(line, i);
      const close = closingBacktickRun(line, i + run, run, unmatched);
      i = close === -1 ? i + run : close + run;
    } else if (c === "[") {
      const link = line[i + 1] === "[" ? wikilinkEnd(line, i) : -1;
      if (link !== -1) {
        i = link;
        continue;
      }
      const end = tkEnd(line, i, unmatched);
      if (end === -1) {
        i++;
      } else {
        const isLink =
          line[end] === "(" && INLINE_LINK_TAIL.test(line.slice(end));
        if (!isLink) {
          out.push({ start: offset + i, end: offset + end, escaped: false });
        }
        i = end;
      }
    } else {
      i++;
    }
  }
}

function isFrontmatterDelimiter(line: string): boolean {
  return /^---[ \t\r]*$/.test(line);
}

function frontmatterEnd(text: string): number {
  const firstBreak = text.indexOf("\n");
  if (firstBreak === -1 || !isFrontmatterDelimiter(text.slice(0, firstBreak))) {
    return 0;
  }
  let pos = firstBreak + 1;
  while (pos < text.length) {
    const lineEnd = text.indexOf("\n", pos);
    const next = lineEnd === -1 ? text.length : lineEnd;
    if (isFrontmatterDelimiter(text.slice(pos, next))) return next;
    pos = next + 1;
  }
  return 0;
}

function quoteDepth(line: string): number {
  let depth = 0;
  for (const c of line) {
    if (c === ">") depth++;
    else if (c !== " " && c !== "\t") break;
  }
  return depth;
}

interface ScannedLine {
  candidates: Candidate[];
  line: number;
  lineStart: number;
  inFrontmatter: boolean;
}

function scan(text: string, parseFrontmatter: boolean): ScannedLine[] {
  const results: ScannedLine[] = [];
  if (!text.includes("[TK")) return results;

  const fmEnd = parseFrontmatter ? frontmatterEnd(text) : 0;
  let fence: { marker: string; length: number; quote: number } | null = null;
  let pos = 0;
  let lineNumber = 0;

  while (pos <= text.length) {
    const lineEnd = text.indexOf("\n", pos);
    const next = lineEnd === -1 ? text.length : lineEnd;
    const line =
      text[next - 1] === "\r" && next > pos
        ? text.slice(pos, next - 1)
        : text.slice(pos, next);
    const inFrontmatter = pos < fmEnd;
    let code = false;

    if (!inFrontmatter) {
      if (fence && fence.quote > 0 && quoteDepth(line) < fence.quote) {
        fence = null;
      }
      if (fence) {
        code = true;
        const close = FENCE_CLOSE.exec(line);
        if (
          close &&
          close[1][0] === fence.marker &&
          close[1].length >= fence.length
        ) {
          fence = null;
        }
      } else {
        const open = FENCE_OPEN.exec(line);
        if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
          code = true;
          fence = {
            marker: open[2][0],
            length: open[2].length,
            quote: quoteDepth(open[1]),
          };
        }
      }
    }

    if (!code && line.includes("[TK")) {
      const candidates: Candidate[] = [];
      scanLine(line, pos, candidates);
      if (candidates.length > 0) {
        results.push({
          candidates,
          line: lineNumber,
          lineStart: pos,
          inFrontmatter,
        });
      }
    }

    pos = next + 1;
    lineNumber++;
  }
  return results;
}

export const RESPONSE_SEPARATOR = " >> ";

/**
 * Finds the first separator outside nested brackets. Escapes and code spans
 * follow the same rules as bracket balancing.
 */
function topLevelSeparator(raw: string): number {
  const unmatched = new Set<number>();
  let depth = 0;
  let i = 4;
  const end = raw.length - 1;
  while (i < end) {
    const c = raw[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "`") {
      const run = backtickRunLength(raw, i);
      const close = closingBacktickRun(raw, i + run, run, unmatched);
      i = close === -1 ? i + run : close + run;
    } else {
      if (depth === 0 && raw.startsWith(RESPONSE_SEPARATOR, i)) return i;
      if (c === "[") depth++;
      if (c === "]") depth--;
      i++;
    }
  }
  return -1;
}

function parseBody(
  raw: string,
  start: number,
): Pick<TK, "body" | "separator" | "response" | "responseStart" | "responseEnd"> {
  const none = { response: null, responseStart: null, responseEnd: null };
  if (raw === "[TK]") return { body: "", separator: null, ...none };

  const at = topLevelSeparator(raw);
  if (at === -1) {
    return { body: raw.slice(4, -1).trim(), separator: null, ...none };
  }
  const body = raw.slice(4, at).trim();
  const afterStart = at + RESPONSE_SEPARATOR.length;
  const after = raw.slice(afterStart, -1);
  const response = after.trim();
  if (response === "") return { body, separator: start + at, ...none };
  const leading = after.length - after.replace(/^\s+/, "").length;
  const responseStart = start + afterStart + leading;
  return {
    body,
    separator: start + at,
    response,
    responseStart,
    responseEnd: responseStart + response.length,
  };
}

export function findTKs(text: string): TK[] {
  const tks: TK[] = [];
  for (const scanned of scan(text, true)) {
    for (const { start, end, escaped } of scanned.candidates) {
      if (escaped) continue;
      const raw = text.slice(start, end);
      const bare = raw === "[TK]";
      tks.push({
        start,
        end,
        line: scanned.line,
        ch: start - scanned.lineStart,
        ...parseBody(raw, start),
        bare,
        raw,
        inFrontmatter: scanned.inFrontmatter,
      });
    }
  }
  return tks;
}

/**
 * Rendered HTML loses the backslash in `\[TK]`, so a reading-view scanner can't
 * tell it from a real TK. This returns one flag per bracket-balanced TK form in
 * source order: true for a real TK, false for an escaped one.
 */
export function tkVisibility(source: string): boolean[] {
  const flags: boolean[] = [];
  for (const scanned of scan(source, false)) {
    for (const candidate of scanned.candidates) {
      flags.push(!candidate.escaped);
    }
  }
  return flags;
}

export function displayText(body: string): string {
  return body
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]*)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

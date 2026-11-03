import { Prec, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { findTKs, type TK } from "./parser";

export interface Span {
  from: number;
  to: number;
}

export interface MarkRange extends Span {
  className: string;
}

const HIDDEN = "hidden";
const WIKILINK = /(!?)\[\[([^[\]|]+\|)?[^[\]]*\]\]/g;

/**
 * Obsidian hides a wikilink's closing brackets inside a [bare link] but not its
 * opener or alias target, which reads as a stray "[[Target|". Hide those too
 * while the chip shows. Embeds stay raw, since they don't render here.
 */
function hiddenLinkSyntax(tk: TK): Span[] {
  const spans: Span[] = [];
  WIKILINK.lastIndex = 0;
  let match = WIKILINK.exec(tk.raw);
  while (match) {
    if (!match[1]) {
      const from = tk.start + match.index;
      spans.push({ from, to: from + 2 + (match[2]?.length ?? 0) });
    }
    match = WIKILINK.exec(tk.raw);
  }
  return spans;
}

export function touches(tk: TK, selection: readonly Span[]): boolean {
  return selection.some(
    (range) => range.from <= tk.end && range.to >= tk.start,
  );
}

/**
 * The chip is built from adjacent marks instead of one mark plus nested bracket
 * marks, so it stays continuous however it gets split around link syntax.
 * Obsidian does split it, once per syntax token.
 */
export function chipRanges(
  tks: readonly TK[],
  selection: readonly Span[],
  livePreview: boolean,
  viewport: Span,
): MarkRange[] {
  const ranges: MarkRange[] = [];
  for (const tk of tks) {
    if (tk.inFrontmatter) continue;
    if (tk.end < viewport.from || tk.start > viewport.to) continue;

    if (!livePreview) {
      ranges.push({ from: tk.start, to: tk.end, className: "tk-source" });
      continue;
    }
    if (touches(tk, selection)) continue;

    const labelEnd = tk.start + (tk.bare ? 3 : 4);
    const closing = tk.end - 1;
    ranges.push({
      from: tk.start,
      to: tk.start + 1,
      className: "tk-cm tk-cm-open tk-bracket",
    });
    ranges.push({
      from: tk.start + 1,
      to: labelEnd,
      className: "tk-cm tk-label",
    });
    if (closing > labelEnd) {
      ranges.push({ from: labelEnd, to: closing, className: "tk-cm" });
    }
    ranges.push({
      from: closing,
      to: tk.end,
      className: "tk-cm tk-cm-close tk-bracket",
    });
    for (const span of hiddenLinkSyntax(tk)) {
      ranges.push({ ...span, className: HIDDEN });
    }
  }
  return ranges;
}

const marks = new Map<string, Decoration>();

function markFor(className: string): Decoration {
  let mark = marks.get(className);
  if (!mark) {
    mark =
      className === HIDDEN
        ? Decoration.replace({})
        : Decoration.mark({ class: className, inclusive: false });
    marks.set(className, mark);
  }
  return mark;
}

export function tkEditorExtension(
  isLivePreview: (state: EditorState) => boolean,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      tks: TK[];
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.tks = findTKs(view.state.doc.toString());
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.tks = findTKs(update.state.doc.toString());
        }
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          isLivePreview(update.startState) !== isLivePreview(update.state)
        ) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const ranges = chipRanges(
          this.tks,
          view.state.selection.ranges,
          isLivePreview(view.state),
          view.viewport,
        );
        return Decoration.set(
          ranges.map((range) =>
            markFor(range.className).range(range.from, range.to),
          ),
          true,
        );
      }
    },
    { decorations: (value) => value.decorations },
  );
  // Lower precedence renders further out, so the chip wraps other plugins' marks.
  // Obsidian's own syntax marks still end up outside it; styles.css allows for both.
  return Prec.lowest(plugin);
}

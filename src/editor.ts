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

export const CHIP_CLASS = "tk-cm";
export const SOURCE_CLASS = "tk-source";
export const RESPONSE_CLASS = "tk-response";

function withStatus(className: string, tk: TK): string {
  return tk.status === "accepted" || tk.status === "rejected"
    ? `${className} tk-${tk.status}`
    : className;
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

/** One box per TK, wrapping everything else so it can be styled as a single pill. */
export function outerRanges(
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
      ranges.push({
        from: tk.start,
        to: tk.end,
        className: withStatus(SOURCE_CLASS, tk),
      });
    } else if (!touches(tk, selection)) {
      ranges.push({
        from: tk.start,
        to: tk.end,
        className: withStatus(CHIP_CLASS, tk),
      });
      // Runs to the closing bracket so the segment takes the pill's right end.
      if (tk.response !== null && tk.separator !== null) {
        ranges.push({
          from: tk.separator + 3,
          to: tk.end,
          className: RESPONSE_CLASS,
        });
      }
    }
  }
  return ranges;
}

/** Brackets, the label and hidden link syntax, inside the chip's box. */
export function innerRanges(
  tks: readonly TK[],
  selection: readonly Span[],
  livePreview: boolean,
  viewport: Span,
): MarkRange[] {
  const ranges: MarkRange[] = [];
  if (!livePreview) return ranges;
  for (const tk of tks) {
    if (tk.inFrontmatter || touches(tk, selection)) continue;
    if (tk.end < viewport.from || tk.start > viewport.to) continue;
    ranges.push({
      from: tk.start,
      to: tk.start + 1,
      className: "tk-bracket",
    });
    ranges.push({
      from: tk.start + 1,
      to: tk.start + tk.prefixLength,
      className: "tk-label",
    });
    ranges.push({ from: tk.end - 1, to: tk.end, className: "tk-bracket" });
    if (tk.separator !== null) {
      ranges.push({
        from: tk.separator + 1,
        to: tk.separator + 3,
        className: "tk-separator",
      });
    }
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

function decorationSet(ranges: MarkRange[]): DecorationSet {
  return Decoration.set(
    ranges.map((range) => markFor(range.className).range(range.from, range.to)),
    true,
  );
}

export function tkEditorExtension(
  isLivePreview: (state: EditorState) => boolean,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      tks: TK[];
      outer: DecorationSet = Decoration.none;
      inner: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.tks = findTKs(view.state.doc.toString());
        this.build(view);
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
          this.build(update.view);
        }
      }

      build(view: EditorView): void {
        const { ranges } = view.state.selection;
        const live = isLivePreview(view.state);
        this.outer = decorationSet(
          outerRanges(this.tks, ranges, live, view.viewport),
        );
        this.inner = decorationSet(
          innerRanges(this.tks, ranges, live, view.viewport),
        );
      }
    },
    {
      provide: (self) => [
        // Older Obsidian builds lack this facet; chips then split per syntax token.
        (EditorView.outerDecorations ?? EditorView.decorations).of(
          (view) => view.plugin(self)?.outer ?? Decoration.none,
        ),
        // Highest precedence renders innermost, so label and bracket colors win
        // over the bare-link token spans Obsidian wraps around them.
        Prec.highest(
          EditorView.decorations.of(
            (view) => view.plugin(self)?.inner ?? Decoration.none,
          ),
        ),
      ],
    },
  );
  return plugin;
}

// @vitest-environment jsdom
import { EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  innerRanges,
  outerRanges,
  tkEditorExtension,
  touches,
} from "../src/editor";
import { findTKs } from "../src/parser";

const FULL = { from: 0, to: 1e9 };

describe("touches", () => {
  const [tk] = findTKs("ab [TK: x] cd");

  it.each([
    [3, 3, true],
    [5, 5, true],
    [tk.end, tk.end, true],
    [0, 3, true],
    [0, 2, false],
    [tk.end + 1, tk.end + 1, false],
  ])("selection %i-%i: %s", (from, to, expected) => {
    expect(touches(tk, [{ from, to }])).toBe(expected);
  });

  it("checks every selection range", () => {
    expect(
      touches(tk, [
        { from: 0, to: 0 },
        { from: 5, to: 5 },
      ]),
    ).toBe(true);
  });
});

describe("ranges", () => {
  const away = [{ from: 0, to: 0 }];
  const texts = (text: string, ranges: { from: number; to: number }[]) =>
    ranges.map((range) => text.slice(range.from, range.to));

  it("makes one outer box per TK, spanning its whole text", () => {
    const text = "\n[TK: see [[Note]] now] and [TK]";
    expect(texts(text, outerRanges(findTKs(text), away, true, FULL))).toEqual([
      "[TK: see [[Note]] now]",
      "[TK]",
    ]);
  });

  it("marks brackets and label inside the box, in document order", () => {
    const text = "\n[TK: abc]";
    const ranges = innerRanges(findTKs(text), away, true, FULL);
    expect(texts(text, ranges)).toEqual(["[", "TK:", "]"]);
    expect(ranges.map((r) => r.className)).toEqual([
      "tk-bracket",
      "tk-label",
      "tk-bracket",
    ]);
  });

  it("never creates an empty range", () => {
    for (const text of ["\n[TK]", "\n[TK:]", "\n[TK: ]"]) {
      const ranges = [
        ...outerRanges(findTKs(text), away, true, FULL),
        ...innerRanges(findTKs(text), away, true, FULL),
      ];
      expect(ranges.length).toBeGreaterThan(0);
      for (const range of ranges) expect(range.to).toBeGreaterThan(range.from);
    }
  });

  it("hides a wikilink opener and alias target, and only those", () => {
    const hidden = (text: string) =>
      texts(
        text,
        innerRanges(findTKs(text), away, true, FULL).filter(
          (range) => range.className === "hidden",
        ),
      );
    expect(hidden("\n[TK: see [[Note]] now]")).toEqual(["[["]);
    expect(hidden("\n[TK: see [[A Note|alias]] now]")).toEqual(["[[A Note|"]);
    expect(hidden("\n[TK: [[a]] and [[b|c]]]")).toEqual(["[[", "[[b|"]);
    expect(hidden("\n[TK: see ![[image.png]]]")).toEqual([]);
    expect(hidden("\n[TK: a [b] c]")).toEqual([]);
    expect(hidden("\n[TK: plain]")).toEqual([]);
  });

  it("adds nothing in source mode beyond the highlight", () => {
    const text = "[TK: see [[Note]]]";
    const tks = findTKs(text);
    expect(innerRanges(tks, away, false, FULL)).toEqual([]);
    expect(outerRanges(tks, [{ from: 2, to: 2 }], false, FULL)).toEqual([
      { from: 0, to: text.length, className: "tk-source" },
    ]);
  });

  it("adds a response segment from after the separator to the pill's end", () => {
    const text = "\n[TK: q >> the answer]";
    const outer = outerRanges(findTKs(text), away, true, FULL);
    expect(outer.map((r) => [r.className, text.slice(r.from, r.to)])).toEqual([
      ["tk-cm", "[TK: q >> the answer]"],
      ["tk-response", " the answer]"],
    ]);
  });

  it("marks the separator, in the comment-only form too", () => {
    for (const text of ["\n[TK: q >> a]", "\n[TK: q >> ]"]) {
      const marks = innerRanges(findTKs(text), away, true, FULL).filter(
        (r) => r.className === "tk-separator",
      );
      expect(texts(text, marks)).toEqual([">>"]);
    }
  });

  it("adds no segment without a response, or for a pipe", () => {
    for (const text of ["\n[TK: q >> ]", "\n[TK: a | b]", "\n[TK: q]"]) {
      const classes = outerRanges(findTKs(text), away, true, FULL).map(
        (r) => r.className,
      );
      expect(classes).toEqual(["tk-cm"]);
    }
  });

  it("drops the segment under the cursor and in source mode", () => {
    const text = "[TK: q >> a]";
    const tks = findTKs(text);
    expect(outerRanges(tks, [{ from: 2, to: 2 }], true, FULL)).toEqual([]);
    expect(outerRanges(tks, away, false, FULL).map((r) => r.className)).toEqual([
      "tk-source",
    ]);
  });

  it("drops the chip for a touched TK only", () => {
    const text = "[TK: a] mid [TK: b]";
    const selection = [{ from: 2, to: 2 }];
    expect(texts(text, outerRanges(findTKs(text), selection, true, FULL))).toEqual(
      ["[TK: b]"],
    );
    expect(
      innerRanges(findTKs(text), selection, true, FULL).every(
        (range) => range.from >= 12,
      ),
    ).toBe(true);
  });

  it("skips frontmatter and anything outside the viewport", () => {
    const text = "---\na: [TK: fm]\n---\n[TK: b]";
    expect(texts(text, outerRanges(findTKs(text), away, true, FULL))).toEqual([
      "[TK: b]",
    ]);
    expect(outerRanges(findTKs(text), away, false, FULL)).toHaveLength(1);
    expect(outerRanges(findTKs("[TK]"), away, true, { from: 5, to: 9 })).toEqual(
      [],
    );
    expect(innerRanges(findTKs("[TK]"), away, true, { from: 5, to: 9 })).toEqual(
      [],
    );
  });
});

describe("in a real EditorView", () => {
  const setLive = StateEffect.define<boolean>();
  const liveField = StateField.define<boolean>({
    create: () => true,
    update: (value, tr) =>
      tr.effects.reduce((v, e) => (e.is(setLive) ? e.value : v), value),
  });

  // Stands in for another provider's link marks. Obsidian's own syntax marks
  // nest differently; that was checked against the real app, not here.
  const fakeLinkSyntax = EditorView.decorations.of((view) => {
    const text = view.state.doc.toString();
    const at = text.indexOf("[[");
    if (at === -1) return Decoration.none;
    return Decoration.set([
      Decoration.mark({ class: "fake-link" }).range(at, text.indexOf("]]") + 2),
    ]);
  });

  let view: EditorView | null = null;

  beforeAll(() => {
    const rects = () =>
      Object.assign([], { item: () => null }) as unknown as DOMRectList;
    Range.prototype.getClientRects = rects;
    Element.prototype.getClientRects = rects;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function open(doc: string, anchor = 0) {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [
          liveField,
          fakeLinkSyntax,
          tkEditorExtension((state) => state.field(liveField)),
        ],
      }),
    });
    return view;
  }

  const contentText = (v: EditorView) =>
    Array.from(v.contentDOM.querySelectorAll(".cm-line"))
      .map((line) => line.textContent)
      .join("\n");
  const chipText = (v: EditorView) =>
    Array.from(v.contentDOM.querySelectorAll(".tk-cm"))
      .map((el) => el.textContent)
      .join("");

  const DOC = "Lead\n\nx [TK: see [[A Note]] now] y";
  const inside = DOC.indexOf("see");

  it("keeps the text in place and chips it when the cursor is away", () => {
    const v = open(DOC);
    expect(v.state.doc.toString()).toBe(DOC);
    expect(contentText(v)).toBe(DOC.replace("[[A", "A"));
    expect(chipText(v)).toBe("[TK: see A Note]] now]");
    expect(v.contentDOM.querySelectorAll(".tk-cm")).toHaveLength(1);
    expect(v.contentDOM.querySelectorAll(".tk-cm .tk-bracket")).toHaveLength(2);
    expect(v.contentDOM.querySelector(".tk-label")?.textContent).toBe("TK:");
  });

  it("stays one box around other providers' marks", () => {
    const v = open(DOC);
    const links = v.contentDOM.querySelectorAll(".fake-link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("A Note]]");
    expect(links[0].closest(".tk-cm")).not.toBeNull();
    expect(v.contentDOM.querySelectorAll(".tk-cm")).toHaveLength(1);
  });

  it("drops the chip when the cursor enters and restores it on leaving", () => {
    const v = open(DOC);
    v.dispatch({ selection: EditorSelection.cursor(inside) });
    expect(v.contentDOM.querySelector(".tk-cm")).toBeNull();
    expect(contentText(v)).toContain("[TK: see [[A Note]] now]");

    v.dispatch({ selection: EditorSelection.cursor(0) });
    expect(chipText(v)).toBe("[TK: see A Note]] now]");
  });

  it("reparses on edits", () => {
    const v = open("Lead\n\n[TK: a]");
    v.dispatch({
      changes: { from: 0, insert: "[TK: new] " },
      selection: { anchor: 0 + "[TK: new] Lead".length },
    });
    expect(chipText(v)).toBe("[TK: new][TK: a]");

    const start = v.state.doc.toString().indexOf("[TK: a]");
    v.dispatch({ changes: { from: start, to: start + 7 } });
    expect(chipText(v)).toBe("[TK: new]");
  });

  it("nests the response segment in one box around a link", () => {
    const v = open("Lead\n\n[TK: q >> see [[A Note]] now]");
    expect(v.contentDOM.querySelectorAll(".tk-cm")).toHaveLength(1);
    const segments = v.contentDOM.querySelectorAll(".tk-cm .tk-response");
    expect(segments).toHaveLength(1);
    expect(segments[0].querySelector(".fake-link")).not.toBeNull();
    expect(segments[0].textContent).toBe(" see A Note]] now]");

    v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length - 2) });
    expect(v.contentDOM.querySelector(".tk-response")).toBeNull();
    expect(v.state.doc.toString()).toContain(">> see [[A Note]] now]");
  });

  it("does not chip an unclosed TK until it closes", () => {
    const v = open("Lead\n[TK: open");
    expect(v.contentDOM.querySelector(".tk-cm")).toBeNull();
    v.dispatch({ changes: { from: v.state.doc.length, insert: "]" } });
    expect(chipText(v)).toBe("[TK: open]");
  });

  it("switches to the light highlight when live preview turns off", () => {
    const v = open(DOC);
    v.dispatch({ effects: setLive.of(false) });
    expect(v.contentDOM.querySelector(".tk-cm")).toBeNull();
    expect(v.contentDOM.querySelector(".tk-source")?.textContent).toBe(
      "[TK: see [[A Note]] now]",
    );
  });
});

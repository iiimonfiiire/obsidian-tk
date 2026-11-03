// @vitest-environment jsdom
import { EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { chipRanges, tkEditorExtension, touches } from "../src/editor";
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

describe("chipRanges", () => {
  const away = [{ from: 0, to: 0 }];

  it("splits a body TK into adjacent, contiguous pieces", () => {
    const text = "\n[TK: abc]";
    const ranges = chipRanges(findTKs(text), away, true, FULL);
    expect(ranges.map((range) => text.slice(range.from, range.to))).toEqual([
      "[",
      "TK:",
      " abc",
      "]",
    ]);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].from).toBe(ranges[i - 1].to);
    }
  });

  it("never creates an empty range", () => {
    for (const text of ["\n[TK]", "\n[TK:]", "\n[TK: ]"]) {
      const ranges = chipRanges(findTKs(text), away, true, FULL);
      expect(ranges.length).toBeGreaterThan(0);
      for (const range of ranges) expect(range.to).toBeGreaterThan(range.from);
    }
  });

  it("hides a wikilink opener and alias target, and only those", () => {
    const hidden = (text: string) =>
      chipRanges(findTKs(text), away, true, FULL)
        .filter((range) => range.className === "hidden")
        .map((range) => text.slice(range.from, range.to));

    expect(hidden("\n[TK: see [[Note]] now]")).toEqual(["[["]);
    expect(hidden("\n[TK: see [[A Note|alias]] now]")).toEqual(["[[A Note|"]);
    expect(hidden("\n[TK: [[a]] and [[b|c]]]")).toEqual(["[[", "[[b|"]);
    expect(hidden("\n[TK: see ![[image.png]]]")).toEqual([]);
    expect(hidden("\n[TK: a [b] c]")).toEqual([]);
    expect(hidden("\n[TK: plain]")).toEqual([]);
  });

  it("hides nothing in source mode or under the cursor", () => {
    const text = "[TK: see [[Note]]]";
    const tks = findTKs(text);
    expect(chipRanges(tks, [{ from: 2, to: 2 }], true, FULL)).toEqual([]);
    expect(
      chipRanges(tks, away, false, FULL).filter((r) => r.className === "hidden"),
    ).toEqual([]);
  });

  it("drops the chip for a touched TK only", () => {
    const text = "[TK: a] mid [TK: b]";
    const ranges = chipRanges(findTKs(text), [{ from: 2, to: 2 }], true, FULL);
    const covered = ranges.map((r) => text.slice(r.from, r.to)).join("");
    expect(covered).toBe("[TK: b]");
  });

  it("uses a whole-range highlight in source mode, even under the cursor", () => {
    const text = "[TK: a]";
    expect(chipRanges(findTKs(text), [{ from: 2, to: 2 }], false, FULL)).toEqual(
      [{ from: 0, to: 7, className: "tk-source" }],
    );
  });

  it("skips frontmatter and anything outside the viewport", () => {
    const text = "---\na: [TK: fm]\n---\n[TK: b]";
    expect(chipRanges(findTKs(text), away, true, FULL).length).toBe(4);
    expect(chipRanges(findTKs(text), away, false, FULL).length).toBe(1);
    expect(chipRanges(findTKs("[TK]"), away, true, { from: 5, to: 9 })).toEqual(
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
    expect(v.contentDOM.querySelectorAll(".tk-bracket")).toHaveLength(2);
    expect(v.contentDOM.querySelector(".tk-label")?.textContent).toBe("TK:");
  });

  it("wraps link syntax so the link mark stays intact and inside the chip", () => {
    const v = open(DOC);
    const links = v.contentDOM.querySelectorAll(".fake-link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("A Note]]");
    expect(links[0].closest(".tk-cm")).not.toBeNull();
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

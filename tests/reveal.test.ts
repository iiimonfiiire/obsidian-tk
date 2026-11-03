import { describe, expect, it } from "vitest";
import { findTKs } from "../src/parser";
import { revealState, selectionRange, toTarget } from "../src/reveal";

describe("TK position", () => {
  it("reports the column within its line", () => {
    const [first, second] = findTKs("one\ntwo [TK: a] x [TK]\r\n\n");
    expect([first.line, first.ch]).toEqual([1, 4]);
    expect([second.line, second.ch]).toEqual([1, 14]);
  });

  it("counts from the line start after CRLF endings", () => {
    const [tk] = findTKs("one\r\n  [TK]");
    expect([tk.line, tk.ch]).toEqual([1, 2]);
  });
});

describe("revealState", () => {
  const text = "first\nlead [TK: see [[Note]] now] tail";
  const [tk] = findTKs(text);
  const state = revealState(toTarget(tk), true);

  it("selects exactly the TK", () => {
    const lines = text.split("\n");
    const { from, to } = selectionRange(toTarget(tk));
    expect(from.line).toBe(to.line);
    expect(lines[from.line].slice(from.ch, to.ch)).toBe(tk.raw);
  });

  it("gives editing mode the TK's range to scroll to", () => {
    const { from, to } = selectionRange(toTarget(tk));
    expect(state.startLoc).toEqual({ line: 1, col: from.ch });
    expect(state.endLoc).toEqual({ line: 1, col: to.ch });
  });

  it("gives reading mode the line to scroll to", () => {
    expect(state.line).toBe(1);
  });

  it("passes focus through, so mobile can avoid the keyboard", () => {
    expect(revealState(toTarget(tk), false).focus).toBe(false);
  });
});

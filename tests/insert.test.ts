import { describe, expect, it } from "vitest";
import { buildInsertion } from "../src/insert";
import { findTKs } from "../src/parser";

describe("buildInsertion", () => {
  it("leaves the cursor inside before the closing bracket", () => {
    const { text, cursor } = buildInsertion("");
    expect(text).toBe("[TK: ]");
    expect(text.slice(cursor)).toBe("]");
    expect(text.slice(0, cursor)).toBe("[TK: ");
  });

  it("wraps a selection and puts the cursor after the closing bracket", () => {
    const { text, cursor } = buildInsertion("fill this");
    expect(text).toBe("[TK: fill this]");
    expect(cursor).toBe(text.length);
  });

  it("keeps surrounding whitespace outside the brackets", () => {
    const { text, cursor } = buildInsertion(" word ");
    expect(text).toBe(" [TK: word] ");
    expect(text.slice(0, cursor)).toBe(" [TK: word]");
  });

  it("collapses a multi-line selection, since TKs are single-line", () => {
    const { text } = buildInsertion("one\n  two\r\nthree");
    expect(text).toBe("[TK: one two three]");
    expect(findTKs(text)[0].body).toBe("one two three");
  });

  it("treats a whitespace-only selection as no selection", () => {
    expect(buildInsertion("  \n ").text).toBe("[TK: ]");
  });

  it("keeps links in a selection intact", () => {
    expect(findTKs(buildInsertion("see [[A Note]]").text)[0].body).toBe(
      "see [[A Note]]",
    );
  });
});

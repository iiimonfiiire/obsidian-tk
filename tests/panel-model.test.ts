import { describe, expect, it } from "vitest";
import {
  countTKs,
  filterFiles,
  isGroupCollapsed,
  noteCountLabel,
  noteName,
  vaultCountLabel,
} from "../src/panel-model";
import { findTKs } from "../src/parser";
import type { FileTKs } from "../src/tk-index";

const file = (path: string, text: string): FileTKs => ({
  path,
  tks: findTKs(text),
});

const FILES = [
  file("Projects/Budget plan.md", "[TK: confirm the numbers] [TK: Ask about Rent]"),
  file("Drafts/Essay.md", "[TK: see [[Budget plan|the plan]] first] [TK]"),
  file("Other.md", "[TK: nothing related]"),
];

const summary = (files: FileTKs[]) =>
  files.map((f) => [f.path, f.tks.map((tk) => tk.body)]);

describe("noteName", () => {
  it("drops folders and the extension", () => {
    expect(noteName("a/b/Some note.md")).toBe("Some note");
    expect(noteName("Top.md")).toBe("Top");
  });
});

describe("filterFiles", () => {
  it("returns everything for an empty or blank query", () => {
    expect(filterFiles(FILES, "")).toBe(FILES);
    expect(filterFiles(FILES, "   ")).toBe(FILES);
  });

  it("matches TK text case-insensitively and keeps only matching rows", () => {
    expect(summary(filterFiles(FILES, "RENT"))).toEqual([
      ["Projects/Budget plan.md", ["Ask about Rent"]],
    ]);
  });

  it("keeps every TK of a note whose name matches", () => {
    const [match, ...rest] = filterFiles(FILES, "essay");
    expect(rest).toEqual([]);
    expect(match.path).toBe("Drafts/Essay.md");
    expect(match.tks).toHaveLength(2);
  });

  it("matches a note name and TK text across notes", () => {
    expect(filterFiles(FILES, "budget").map((f) => f.path)).toEqual([
      "Projects/Budget plan.md",
      "Drafts/Essay.md",
    ]);
  });

  it("matches the text a row displays, as well as the raw body", () => {
    expect(summary(filterFiles(FILES, "the plan"))).toEqual([
      ["Drafts/Essay.md", ["see [[Budget plan|the plan]] first"]],
    ]);
  });

  it("does not match folder names", () => {
    expect(filterFiles(FILES, "projects")).toEqual([]);
  });

  it("returns nothing when nothing matches and leaves the input alone", () => {
    expect(filterFiles(FILES, "zzz")).toEqual([]);
    expect(countTKs(FILES)).toBe(5);
  });
});

describe("searching responses", () => {
  const files = [
    file("One.md", "[TK: question one | Answer with Marker] [TK: other]"),
    file("Two.md", "[TK: q | see [[Target|the alias]] here]"),
  ];

  it("matches response text case-insensitively, keeping that row only", () => {
    expect(filterFiles(files, "marker").map((f) => f.tks.length)).toEqual([1]);
    expect(filterFiles(files, "marker")[0].path).toBe("One.md");
  });

  it("matches the displayed text of a link in a response", () => {
    expect(filterFiles(files, "the alias").map((f) => f.path)).toEqual([
      "Two.md",
    ]);
  });

  it("counts a TK with a response as open", () => {
    expect(countTKs(files)).toBe(3);
    expect(vaultCountLabel(files, files, "")).toBe("3 open in 2 notes");
  });
});

describe("isGroupCollapsed", () => {
  const collapsed = new Set(["a.md"]);

  it("follows the state with no search", () => {
    expect(isGroupCollapsed("a.md", collapsed, "")).toBe(true);
    expect(isGroupCollapsed("b.md", collapsed, "")).toBe(false);
  });

  it("shows every group expanded while searching", () => {
    expect(isGroupCollapsed("a.md", collapsed, "x")).toBe(false);
    expect(collapsed.has("a.md")).toBe(true);
  });

  it("treats a blank query as no search", () => {
    expect(isGroupCollapsed("a.md", collapsed, "  ")).toBe(true);
  });
});

describe("count labels", () => {
  it("describes the whole vault with no search", () => {
    expect(vaultCountLabel(FILES, FILES, "")).toBe("5 open in 3 notes");
    expect(vaultCountLabel(FILES.slice(2), FILES.slice(2), "")).toBe(
      "1 open in 1 note",
    );
    expect(vaultCountLabel([], [], "")).toBe("");
  });

  it("describes the filtered subset while searching", () => {
    const shown = filterFiles(FILES, "rent");
    expect(vaultCountLabel(FILES, shown, "rent")).toBe("1 of 5 in 1 of 3 notes");
    expect(vaultCountLabel(FILES, [], "zzz")).toBe("0 of 5 in 0 of 3 notes");
  });

  it("describes a single note", () => {
    expect(noteCountLabel(4, 4, "")).toBe("4 open");
    expect(noteCountLabel(4, 1, "x")).toBe("1 of 4 open");
    expect(noteCountLabel(0, 0, "x")).toBe("0 open");
  });
});

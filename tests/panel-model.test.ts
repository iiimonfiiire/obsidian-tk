import { describe, expect, it } from "vitest";
import {
  countTKs,
  filterFiles,
  isGroupCollapsed,
  noteName,
  countsByFilter,
  emptyState,
  filterByStatus,
  headerLabel,
  isStatusFilter,
  matchesFilter,
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
    file("One.md", "[TK: question one >> Answer with Marker] [TK: other]"),
    file("Two.md", "[TK: q >> see [[Target|the alias]] here]"),
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

describe("status filters", () => {
  const files = [
    file(
      "One.md",
      "[TK: open one] [TK: asked >> answered] [TK accepted: ok] [TK rejected: no >> why]",
    ),
    file("Two.md", "[TK] [TK accepted: done >> yes]"),
    file("Three.md", "[TK rejected: only closed]"),
  ];
  const bodies = (result: FileTKs[]) =>
    result.flatMap((f) => f.tks.map((tk) => tk.body));

  it("queue is open plus responded, in order", () => {
    expect(bodies(filterByStatus(files, "queue"))).toEqual([
      "open one",
      "asked",
      "",
    ]);
  });

  it("each status filter keeps only its own", () => {
    expect(bodies(filterByStatus(files, "open"))).toEqual(["open one", ""]);
    expect(bodies(filterByStatus(files, "responded"))).toEqual(["asked"]);
    expect(bodies(filterByStatus(files, "accepted"))).toEqual(["ok", "done"]);
    expect(bodies(filterByStatus(files, "rejected"))).toEqual([
      "no",
      "only closed",
    ]);
  });

  it("all keeps everything", () => {
    expect(filterByStatus(files, "all")).toBe(files);
  });

  it("drops notes with nothing left", () => {
    expect(filterByStatus(files, "queue").map((f) => f.path)).toEqual([
      "One.md",
      "Two.md",
    ]);
  });

  it("counts per filter", () => {
    expect(countsByFilter(files)).toEqual({
      queue: 3,
      open: 2,
      responded: 1,
      accepted: 2,
      rejected: 2,
      all: 7,
    });
  });

  it("combines with search", () => {
    const searched = filterFiles(files, "why");
    expect(bodies(filterByStatus(searched, "queue"))).toEqual([]);
    expect(bodies(filterByStatus(searched, "rejected"))).toEqual(["no"]);
  });

  it("validates stored values", () => {
    expect(isStatusFilter("queue")).toBe(true);
    expect(isStatusFilter("resolved")).toBe(false);
    expect(isStatusFilter(undefined)).toBe(false);
  });

  it("matches a single TK", () => {
    const [tk] = findTKs("[TK accepted: x]");
    expect(matchesFilter(tk, "queue")).toBe(false);
    expect(matchesFilter(tk, "all")).toBe(true);
  });

  it("the header shows the queue count, whatever is shown", () => {
    const queue = filterByStatus(files, "queue");
    expect(headerLabel(files, queue, "queue", "")).toBe("3 in queue");
    expect(headerLabel(files, filterByStatus(files, "accepted"), "accepted", "")).toBe(
      "3 in queue · showing 2",
    );
    expect(headerLabel(files, [], "queue", "zzz")).toBe("3 in queue · showing 0");
    expect(headerLabel([], [], "queue", "")).toBe("0 in queue");
  });
});

describe("emptyState", () => {
  it("celebrates an empty queue, plainly", () => {
    expect(emptyState("queue", "vault", "")).toEqual({
      title: "Queue clear.",
      detail: "Nothing waiting in the vault.",
    });
    expect(emptyState("queue", "note", "").detail).toBe(
      "Nothing waiting in this note.",
    );
  });

  it("names the filter and the search", () => {
    expect(emptyState("accepted", "note", "").title).toBe(
      "No accepted TKs in this note.",
    );
    expect(emptyState("all", "vault", "").title).toBe("No TKs in the vault.");
    expect(emptyState("queue", "vault", " q ").title).toBe(
      'Nothing in the queue matches "q".',
    );
    expect(emptyState("rejected", "vault", "q").title).toBe(
      'No rejected TKs match "q".',
    );
    expect(emptyState("all", "vault", "q").title).toBe('No TKs match "q".');
  });
});

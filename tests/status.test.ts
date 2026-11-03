import { describe, expect, it } from "vitest";
import { findTKs, type TK } from "../src/parser";
import {
  applyEdit,
  planStatusEdit,
  refOf,
  relocate,
  type TargetStatus,
} from "../src/status";

function rewrite(
  text: string,
  pick: (tks: TK[]) => TK,
  status: TargetStatus,
  current = text,
): string | string[] {
  const tks = findTKs(text);
  const plan = planStatusEdit(current, refOf(tks, pick(tks)), status);
  return plan.ok ? applyEdit(current, plan.edit) : [plan.reason];
}

const first = (tks: TK[]) => tks[0];

describe("planStatusEdit", () => {
  it("accepts and rejects, changing only the prefix", () => {
    expect(rewrite("a [TK: q] b", first, "accepted")).toBe(
      "a [TK accepted: q] b",
    );
    expect(rewrite("a [TK: q >> r] b", first, "rejected")).toBe(
      "a [TK rejected: q >> r] b",
    );
  });

  it("reopens to the status the text implies", () => {
    const open = rewrite("[TK accepted: q]", first, "open") as string;
    expect(open).toBe("[TK: q]");
    expect(findTKs(open)[0].status).toBe("open");
    const responded = rewrite("[TK rejected: q >> r]", first, "open") as string;
    expect(responded).toBe("[TK: q >> r]");
    expect(findTKs(responded)[0].status).toBe("responded");
  });

  it("moves directly between closed statuses", () => {
    expect(rewrite("[TK accepted: q]", first, "rejected")).toBe(
      "[TK rejected: q]",
    );
  });

  it("gives a bare TK a form that stays a TK", () => {
    const accepted = rewrite("x [TK] y", first, "accepted") as string;
    expect(accepted).toBe("x [TK accepted:] y");
    expect(findTKs(accepted)[0].status).toBe("accepted");
    expect(rewrite(accepted, first, "open")).toBe("x [TK:] y");
  });

  it("leaves nested wikilinks byte for byte", () => {
    expect(
      rewrite("[TK: see [[A Note|alias]] here >> in [[B]]]", first, "accepted"),
    ).toBe("[TK accepted: see [[A Note|alias]] here >> in [[B]]]");
  });

  it("works in a table row and keeps the row", () => {
    expect(rewrite("| Cell [TK: q >> a] | Value |", first, "rejected")).toBe(
      "| Cell [TK rejected: q >> a] | Value |",
    );
  });

  it("changes the correct one of two identical TKs", () => {
    const text = "[TK: same]\nmiddle\n[TK: same]";
    expect(rewrite(text, (t) => t[0], "accepted")).toBe(
      "[TK accepted: same]\nmiddle\n[TK: same]",
    );
    expect(rewrite(text, (t) => t[1], "accepted")).toBe(
      "[TK: same]\nmiddle\n[TK accepted: same]",
    );
  });

  it("keeps the right twin when unsaved text moved them", () => {
    const text = "[TK: same] and [TK: same]";
    const moved = "New line above.\n[TK: same] and [TK: same] more";
    expect(rewrite(text, (t) => t[1], "accepted", moved)).toBe(
      "New line above.\n[TK: same] and [TK accepted: same] more",
    );
  });

  it("does not match a twin hiding in a code span", () => {
    const text = "`[TK: same]` [TK: same]";
    expect(rewrite(text, first, "accepted")).toBe(
      "`[TK: same]` [TK accepted: same]",
    );
  });

  it("refuses when the TK is gone or its text changed", () => {
    expect(rewrite("[TK: q]", first, "accepted", "nothing here")).toEqual([
      "gone",
    ]);
    expect(rewrite("[TK: q]", first, "accepted", "[TK: q edited]")).toEqual([
      "gone",
    ]);
    expect(rewrite("[TK: q]", first, "accepted", "[TK accepted: q]")).toEqual([
      "gone",
    ]);
  });

  it("refuses when twins were added or removed", () => {
    expect(
      rewrite("[TK: same]", first, "accepted", "[TK: same] [TK: same]"),
    ).toEqual(["ambiguous"]);
    expect(
      rewrite("[TK: same] [TK: same]", (t) => t[1], "accepted", "[TK: same]"),
    ).toEqual(["ambiguous"]);
  });

  it("copes with CRLF and frontmatter", () => {
    expect(rewrite("one\r\n[TK: q]\r\ntwo", first, "accepted")).toBe(
      "one\r\n[TK accepted: q]\r\ntwo",
    );
    expect(rewrite('---\na: "[TK: q]"\n---\n', first, "accepted")).toBe(
      '---\na: "[TK accepted: q]"\n---\n',
    );
  });
});

describe("relocate", () => {
  it("refuses a ref that never matched", () => {
    const tks = findTKs("[TK: a]");
    expect(relocate(tks, { raw: "[TK: a]", ordinal: -1, total: 1 })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });
});

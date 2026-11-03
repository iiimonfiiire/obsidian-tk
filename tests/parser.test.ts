import { describe, expect, it } from "vitest";
import { displayText, findTKs, tkVisibility } from "../src/parser";

const bodies = (text: string) => findTKs(text).map((tk) => tk.body);
const raws = (text: string) => findTKs(text).map((tk) => tk.raw);

describe("basic forms", () => {
  it("finds a bare TK", () => {
    const [tk, ...rest] = findTKs("Before [TK] after");
    expect(rest).toEqual([]);
    expect(tk).toMatchObject({
      start: 7,
      end: 11,
      line: 0,
      body: "",
      bare: true,
      raw: "[TK]",
      inFrontmatter: false,
    });
  });

  it("finds a TK with a body and exact offsets", () => {
    const text = "One\nTwo [TK: fill this in] three";
    const [tk] = findTKs(text);
    expect(tk).toMatchObject({ line: 1, body: "fill this in", bare: false });
    expect(text.slice(tk.start, tk.end)).toBe("[TK: fill this in]");
  });

  it("accepts a body with no space after the colon", () => {
    expect(bodies("[TK:tight]")).toEqual(["tight"]);
  });

  it("accepts empty bodies, as the insert command creates them", () => {
    expect(raws("[TK: ] and [TK:]")).toEqual(["[TK: ]", "[TK:]"]);
    expect(bodies("[TK: ]")).toEqual([""]);
    expect(findTKs("[TK: ]")[0].bare).toBe(false);
  });

  it("finds several TKs on one line", () => {
    expect(raws("[TK] a [TK: b] c [TK]")).toEqual(["[TK]", "[TK: b]", "[TK]"]);
  });

  it("returns nothing for text with no TK", () => {
    expect(findTKs("")).toEqual([]);
    expect(findTKs("plain text\n\nmore [brackets]")).toEqual([]);
  });

  it("reports line numbers across many lines", () => {
    const tks = findTKs("[TK]\n\n\n[TK: a]\n[TK: b]");
    expect(tks.map((tk) => tk.line)).toEqual([0, 3, 4]);
  });

  it("handles CRLF line endings", () => {
    const text = "one\r\n[TK: a]\r\n```\r\n[TK: b]\r\n```\r\n[TK: c]\r\n";
    expect(bodies(text)).toEqual(["a", "c"]);
    expect(findTKs(text)[0].line).toBe(1);
  });
});

describe("lookalikes", () => {
  it.each([
    "[TKO]",
    "[TK-1]",
    "[TKs: x]",
    "[tk]",
    "[tk: x]",
    "[Tk: x]",
    "[ TK]",
    "[TK ]",
    "[TK : x]",
    "TK",
    "TK: x",
    "[xTK: y]",
  ])("ignores %s", (text) => {
    expect(findTKs(text)).toEqual([]);
  });
});

describe("nested brackets", () => {
  it("captures a nested wikilink whole", () => {
    const body = "your reasoning. It is item 9 of 10 in [[Some Note]]. More text.";
    const text = `Lead [TK: ${body}] tail`;
    const [tk] = findTKs(text);
    expect(tk.body).toBe(body);
    expect(text.slice(tk.end)).toBe(" tail");
  });

  it("captures aliased wikilinks, markdown links and plain brackets", () => {
    expect(bodies("[TK: see [[A Note|alias]] now]")).toEqual([
      "see [[A Note|alias]] now",
    ]);
    expect(bodies("[TK: see [docs](https://example.com) now]")).toEqual([
      "see [docs](https://example.com) now",
    ]);
    expect(bodies("[TK: a [b [c] d] e]")).toEqual(["a [b [c] d] e"]);
  });

  it("captures a body that ends in a wikilink", () => {
    expect(raws("[TK: [[Note]]]")).toEqual(["[TK: [[Note]]]"]);
  });

  it("treats an inner TK as part of the outer one", () => {
    expect(raws("[TK: outer [TK: inner] more]")).toEqual([
      "[TK: outer [TK: inner] more]",
    ]);
  });

  it("does not count escaped brackets toward the balance", () => {
    expect(raws("[TK: a \\] b] tail")).toEqual(["[TK: a \\] b]"]);
    expect(raws("[TK: a \\[ b] tail")).toEqual(["[TK: a \\[ b]"]);
  });

  it("does not count brackets inside a code span in the body", () => {
    expect(raws("[TK: use `a]` here] tail")).toEqual(["[TK: use `a]` here]"]);
  });

  it("does not match when the brackets never balance", () => {
    expect(findTKs("[TK: a [b] c")).toEqual([]);
  });

  it("still finds a real TK nested in an unclosed one", () => {
    expect(raws("[TK: never closed [TK] tail")).toEqual(["[TK]"]);
  });
});

describe("single line only", () => {
  it("does not run an unclosed TK across a newline", () => {
    expect(findTKs("[TK: start\nend]")).toEqual([]);
  });

  it("recovers on the next line", () => {
    expect(bodies("[TK: start\n[TK: next]")).toEqual(["next"]);
  });
});

describe("escaping", () => {
  it("ignores an escaped opening bracket", () => {
    expect(findTKs("\\[TK]")).toEqual([]);
    expect(findTKs("\\[TK: x]")).toEqual([]);
  });

  it("matches after an escaped backslash", () => {
    expect(raws("\\\\[TK: x]")).toEqual(["[TK: x]"]);
  });

  it("keeps scanning after an escaped TK", () => {
    expect(raws("\\[TK: a] then [TK: b]")).toEqual(["[TK: b]"]);
  });
});

describe("inline code", () => {
  it("ignores TKs in code spans", () => {
    expect(findTKs("Use `[TK]` or `[TK: x]`.")).toEqual([]);
  });

  it("honors double-backtick spans", () => {
    expect(findTKs("``a ` [TK] b``")).toEqual([]);
  });

  it("finds a TK next to a code span", () => {
    expect(raws("`code` [TK: real] `code`")).toEqual(["[TK: real]"]);
  });

  it("treats an unmatched backtick as literal", () => {
    expect(raws("a ` stray [TK: real]")).toEqual(["[TK: real]"]);
  });

  it("does not close a span with a run of a different length", () => {
    expect(raws("`` a ` [TK: real]")).toEqual(["[TK: real]"]);
  });

  it("does not let a stray backtick hide a TK on a later line", () => {
    expect(raws("a ` stray\n[TK: real] ` b")).toEqual(["[TK: real]"]);
  });
});

describe("fenced code", () => {
  it("ignores backtick and tilde fences", () => {
    expect(findTKs("```\n[TK: a]\n```")).toEqual([]);
    expect(findTKs("~~~\n[TK: a]\n~~~")).toEqual([]);
  });

  it("resumes after the fence closes", () => {
    expect(bodies("```md\n[TK: a]\n```\n[TK: b]")).toEqual(["b"]);
  });

  it("requires a closing fence at least as long as the opener", () => {
    expect(bodies("````\n```\n[TK: a]\n````\n[TK: b]")).toEqual(["b"]);
    expect(bodies("```\n[TK: a]\n`````\n[TK: b]")).toEqual(["b"]);
  });

  it("does not close a fence with the other marker", () => {
    expect(bodies("```\n~~~\n[TK: a]\n```\n[TK: b]")).toEqual(["b"]);
    expect(bodies("~~~\n```\n[TK: a]\n~~~\n[TK: b]")).toEqual(["b"]);
  });

  it("does not close a fence with a line that has trailing text", () => {
    expect(bodies("```\n``` not a close\n[TK: a]\n```\n[TK: b]")).toEqual(["b"]);
  });

  it("runs an unclosed fence to the end of the file", () => {
    expect(findTKs("```\n[TK: a]\n\n[TK: b]")).toEqual([]);
  });

  it("does not treat short runs or inline triple backticks as fences", () => {
    expect(bodies("``\n[TK: a]")).toEqual(["a"]);
    expect(bodies("```inline``` text\n[TK: a]")).toEqual(["a"]);
  });

  it("allows an info string on tilde fences containing backticks", () => {
    expect(findTKs("~~~ a`b\n[TK: a]\n~~~")).toEqual([]);
  });

  it("handles indented and list-nested fences", () => {
    expect(bodies("  ```\n  [TK: a]\n  ```\n[TK: b]")).toEqual(["b"]);
    expect(bodies("- item\n    ```\n    [TK: a]\n    ```\n[TK: b]")).toEqual([
      "b",
    ]);
    expect(bodies("- ```\n  [TK: a]\n  ```\n[TK: b]")).toEqual(["b"]);
  });

  it("handles fences in blockquotes and ends them with the quote", () => {
    expect(bodies("> ```\n> [TK: a]\n> ```\n> [TK: b]")).toEqual(["b"]);
    expect(bodies("> ```\n> [TK: a]\n\n[TK: b]")).toEqual(["b"]);
  });
});

describe("links that look like TKs", () => {
  it("ignores wikilinks to a note named TK", () => {
    expect(findTKs("[[TK]]")).toEqual([]);
    expect(findTKs("![[TK]]")).toEqual([]);
    expect(findTKs("[[TK: x]]")).toEqual([]);
  });

  it("ignores inline links whose text looks like a TK", () => {
    expect(findTKs("[TK](https://example.com)")).toEqual([]);
    expect(findTKs('[TK: x](https://example.com "title")')).toEqual([]);
    expect(findTKs("![TK](image.png)")).toEqual([]);
  });

  it("keeps a TK standing in for a link with no destination yet", () => {
    expect(raws("Read [TK: link to the post]() today")).toEqual([
      "[TK: link to the post]",
    ]);
    expect(raws("[TK]()")).toEqual(["[TK]"]);
    expect(raws("[TK](<>)")).toEqual(["[TK]"]);
  });

  it("keeps a TK followed by prose in parentheses", () => {
    expect(raws("[TK](see the draft)")).toEqual(["[TK]"]);
    expect(raws("[TK] (aside)")).toEqual(["[TK]"]);
  });

  it("finds a TK that sits in other brackets", () => {
    expect(raws("[see [TK] there]")).toEqual(["[TK]"]);
  });
});

describe("frontmatter", () => {
  const text = "---\ntitle: x\nsummary: \"[TK: a summary]\"\n---\nBody [TK: b]\n";

  it("parses TKs in frontmatter and flags them", () => {
    const tks = findTKs(text);
    expect(tks.map((tk) => [tk.body, tk.inFrontmatter, tk.line])).toEqual([
      ["a summary", true, 2],
      ["b", false, 4],
    ]);
  });

  it("does not treat a fence marker in frontmatter as a code block", () => {
    expect(bodies("---\nnote: x\n~~~\n---\n[TK: b]")).toEqual(["b"]);
  });

  it("needs the opening delimiter on the first line and a closer", () => {
    expect(findTKs("\n---\n[TK: a]\n---\n")[0].inFrontmatter).toBe(false);
    expect(findTKs("---\n[TK: a]\n")[0].inFrontmatter).toBe(false);
  });
});

describe("responses", () => {
  const one = (text: string) => findTKs(text)[0];
  const slice = (text: string) => {
    const tk = one(text);
    return text.slice(tk.responseStart ?? 0, tk.responseEnd ?? 0);
  };

  it("splits comment and response", () => {
    const tk = one("[TK: Is there a style guide? >> Not yet.]");
    expect(tk.body).toBe("Is there a style guide?");
    expect(tk.response).toBe("Not yet.");
  });

  it("gives exact offsets for the separator and the trimmed response", () => {
    const text = "lead [TK: q >>   the answer  ] tail";
    const tk = one(text);
    expect(text.slice(tk.separator ?? 0, (tk.separator ?? 0) + 4)).toBe(" >> ");
    expect(slice(text)).toBe("the answer");
  });

  it("requires a space on both sides", () => {
    for (const text of ["[TK: a>>b]", "[TK: a >>b]", "[TK: a>> b]", "[TK: q >>]"]) {
      expect(one(text).separator).toBeNull();
      expect(one(text).response).toBeNull();
    }
  });

  it("no longer splits on a pipe", () => {
    const tk = one("[TK: a | b]");
    expect(tk.body).toBe("a | b");
    expect(tk.response).toBeNull();
  });

  it("works in a table row, with no pipe to break the cell", () => {
    const tk = one("| Cell [TK: q >> a] | Value |");
    expect([tk.body, tk.response]).toEqual(["q", "a"]);
  });

  it("has no response fields without a separator", () => {
    expect(one("[TK: plain]")).toMatchObject({
      body: "plain",
      separator: null,
      response: null,
      responseStart: null,
      responseEnd: null,
    });
  });

  it("keeps bare TKs working", () => {
    expect(one("[TK]")).toMatchObject({
      body: "",
      bare: true,
      separator: null,
      response: null,
    });
  });

  it("handles aliased wikilinks on both sides", () => {
    const tk = one("[TK: [[A|a]] or [[B|b]]? >> [[C|c]] and [[D|d]]]");
    expect(tk.body).toBe("[[A|a]] or [[B|b]]?");
    expect(tk.response).toBe("[[C|c]] and [[D|d]]");
  });

  it("gives later separators to the response", () => {
    const tk = one("[TK: a >> b >> c]");
    expect(tk.body).toBe("a");
    expect(tk.response).toBe("b >> c");
  });

  it("ignores a separator in nested brackets", () => {
    expect(one("[TK: a [x >> y] b]").response).toBeNull();
    expect(one("[TK: a [x >> y] b >> c]").response).toBe("c");
  });

  it("treats a separator with nothing after it as no response yet", () => {
    for (const text of ["[TK: question >> ]", "[TK: question >>   ]"]) {
      const tk = one(text);
      expect(tk.body).toBe("question");
      expect(tk.separator).not.toBeNull();
      expect(tk.response).toBeNull();
      expect(tk.responseStart).toBeNull();
    }
  });

  it("allows an empty comment with a response", () => {
    const tk = one("[TK: >> answer first]");
    expect(tk.body).toBe("");
    expect(tk.response).toBe("answer first");
  });

  it("ignores a separator in a code span", () => {
    expect(one("[TK: use `a >> b` here]").response).toBeNull();
    const tk = one("[TK: use `a >> b` here >> or `c >> d`]");
    expect(tk.body).toBe("use `a >> b` here");
    expect(tk.response).toBe("or `c >> d`");
  });

  it("works in frontmatter and with a link with no destination", () => {
    const fm = one('---\nsummary: "[TK: q >> a]"\n---\n');
    expect([fm.inFrontmatter, fm.response]).toEqual([true, "a"]);
    expect(one("[TK: q >> a]()").response).toBe("a");
  });

  it("keeps raw and the full range unchanged", () => {
    const text = "x [TK: q >> a] y";
    const tk = one(text);
    expect(tk.raw).toBe("[TK: q >> a]");
    expect(text.slice(tk.start, tk.end)).toBe(tk.raw);
  });
});

describe("statuses", () => {
  const one = (text: string) => findTKs(text)[0];

  it("derives open and responded", () => {
    expect(one("[TK: q]").status).toBe("open");
    expect(one("[TK]").status).toBe("open");
    expect(one("[TK: q >> ]").status).toBe("open");
    expect(one("[TK: q >> a]").status).toBe("responded");
  });

  it("reads accepted and rejected, with or without a response", () => {
    expect(one("[TK accepted: q]")).toMatchObject({
      status: "accepted",
      body: "q",
      response: null,
    });
    expect(one("[TK accepted: q >> a]")).toMatchObject({
      status: "accepted",
      body: "q",
      response: "a",
    });
    expect(one("[TK rejected: q]").status).toBe("rejected");
    expect(one("[TK rejected: q >> a]")).toMatchObject({
      status: "rejected",
      response: "a",
    });
  });

  it("gives offsets past the longer prefix", () => {
    const text = "x [TK accepted: q >> the answer] y";
    const tk = one(text);
    expect(text.slice(tk.responseStart ?? 0, tk.responseEnd ?? 0)).toBe(
      "the answer",
    );
    expect(text.slice(tk.start, tk.start + tk.prefixLength)).toBe(
      "[TK accepted:",
    );
  });

  it.each([
    "[TK done: x]",
    "[TK Accepted: x]",
    "[TK ACCEPTED: x]",
    "[TK accepted x]",
    "[TK  accepted: x]",
    "[TK accepted : x]",
    "[TK\taccepted: x]",
    "[TKaccepted: x]",
    "[TK accepted]",
    "[TK rejected]",
    "[tk accepted: x]",
    "[TK accepteds: x]",
  ])("leaves %s as plain text", (text) => {
    expect(findTKs(text)).toEqual([]);
  });

  it("applies the other rules equally", () => {
    expect(one("[TK accepted: see [[A|b]] now >> [[C|d]]]")).toMatchObject({
      body: "see [[A|b]] now",
      response: "[[C|d]]",
    });
    expect(findTKs("`[TK accepted: x]`")).toEqual([]);
    expect(findTKs("```\n[TK rejected: x]\n```")).toEqual([]);
    expect(findTKs("\\[TK accepted: x]")).toEqual([]);
    expect(findTKs("[[TK accepted: x]]")).toEqual([]);
    expect(findTKs("[TK accepted: x](https://example.com)")).toEqual([]);
    expect(findTKs("[TK accepted: open")).toEqual([]);
    expect(one("[TK accepted: x]()")).toMatchObject({
      status: "accepted",
      raw: "[TK accepted: x]",
    });
    expect(one("---\na: \"[TK rejected: x]\"\n---\n")).toMatchObject({
      status: "rejected",
      inFrontmatter: true,
    });
  });

  it("flags an escaped closed TK like any other", () => {
    expect(tkVisibility("\\[TK accepted: a] [TK rejected: b]")).toEqual([
      false,
      true,
    ]);
  });

  it("leaves existing forms unchanged", () => {
    expect(one("[TK: a]")).toMatchObject({ prefixLength: 4, body: "a" });
    expect(one("[TK]")).toMatchObject({ prefixLength: 3, bare: true });
  });
});

describe("tkVisibility", () => {
  it("flags escaped forms false and real forms true, in source order", () => {
    expect(tkVisibility("\\[TK: a] [TK: b] \\[TK] [TK]")).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("leaves out code, links and unbalanced forms", () => {
    expect(tkVisibility("`[TK]` [[TK]] [TK](x.md) \\[TK: open")).toEqual([]);
  });
});

describe("displayText", () => {
  it("strips link syntax for display", () => {
    expect(displayText("see [[A Note]] now")).toBe("see A Note now");
    expect(displayText("see [[A Note|alias]] now")).toBe("see alias now");
    expect(displayText("see [docs](https://example.com) now")).toBe(
      "see docs now",
    );
    expect(displayText("see ![[image.png]]")).toBe("see image.png");
  });

  it("leaves plain text and plain brackets alone", () => {
    expect(displayText("a [b] c")).toBe("a [b] c");
  });
});

describe("performance guard", () => {
  it("stays fast on a long line of unmatched backticks", () => {
    const line = "`a ``b ```c ".repeat(20000) + "[TK: end]";
    const started = Date.now();
    expect(bodies(line)).toEqual(["end"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

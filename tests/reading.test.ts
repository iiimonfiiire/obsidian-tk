// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { tkVisibility } from "../src/parser";
import { decorateTKs } from "../src/reading";

function render(html: string, visibility?: boolean[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  decorateTKs(root, visibility);
  return root;
}

const chips = (root: Element) =>
  Array.from(root.querySelectorAll(".tk-chip")).map((chip) => chip.textContent);

describe("decorateTKs", () => {
  it("wraps a bare TK and keeps surrounding text", () => {
    const root = render("<p>Before [TK] after</p>");
    expect(chips(root)).toEqual(["[TK]"]);
    expect(root.textContent).toBe("Before [TK] after");
  });

  it("wraps a TK with a body into bracket, label and text", () => {
    const root = render("<p>x [TK: fill this] y</p>");
    const chip = root.querySelector(".tk-chip")!;
    const parts = Array.from(chip.childNodes).map((node) => node.textContent);
    expect(parts).toEqual(["[", "TK:", " fill this", "]"]);
    expect(chip.querySelectorAll(".tk-bracket")).toHaveLength(2);
    expect(chip.querySelector(".tk-label")?.textContent).toBe("TK:");
  });

  it("wraps a span of sibling nodes around a link", () => {
    const root = render(
      '<p>Lead [TK: your reasoning, see <a class="internal-link" href="Some Note">Some Note</a>. More text.] tail</p>',
    );
    expect(chips(root)).toEqual([
      "[TK: your reasoning, see Some Note. More text.]",
    ]);
    const link = root.querySelector(".tk-chip a.internal-link");
    expect(link?.getAttribute("href")).toBe("Some Note");
    expect(root.textContent).toBe(
      "Lead [TK: your reasoning, see Some Note. More text.] tail",
    );
  });

  it("keeps the same element so its listeners survive", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p>[TK: see <a href="x">x</a> now]</p>';
    const link = root.querySelector("a");
    decorateTKs(root);
    expect(root.querySelector(".tk-chip a")).toBe(link);
  });

  it("wraps a TK that ends right after a link", () => {
    const root = render('<p>[TK: <a href="x">x</a>]</p>');
    expect(chips(root)).toEqual(["[TK: x]"]);
  });

  it("wraps across several links and inline formatting", () => {
    const root = render(
      '<p>[TK: <a href="a">a</a> and <strong>b</strong> and <a href="c">c</a>] end [TK]</p>',
    );
    expect(chips(root)).toEqual(["[TK: a and b and c]", "[TK]"]);
    expect(root.querySelector(".tk-chip strong")?.textContent).toBe("b");
  });

  it("balances nested brackets in text", () => {
    const root = render("<p>[TK: a [b] c] d</p>");
    expect(chips(root)).toEqual(["[TK: a [b] c]"]);
  });

  it("finds several TKs in one text node", () => {
    expect(chips(render("<p>[TK] a [TK: b] c [TK: d]</p>"))).toEqual([
      "[TK]",
      "[TK: b]",
      "[TK: d]",
    ]);
  });

  it("descends into inline and block containers", () => {
    const root = render(
      "<ul><li><strong>[TK: a]</strong></li></ul><blockquote><p>[TK: b]</p></blockquote><table><tbody><tr><td>[TK: c]</td></tr></tbody></table><h2>[TK: d]</h2>",
    );
    expect(chips(root)).toEqual(["[TK: a]", "[TK: b]", "[TK: c]", "[TK: d]"]);
  });

  it("skips code, preformatted text and frontmatter", () => {
    const root = render(
      '<pre><code>[TK: a]</code></pre><p><code>[TK: b]</code></p><pre class="frontmatter">[TK: c]</pre><div class="metadata-container"><span>[TK: d]</span></div>',
    );
    expect(chips(root)).toEqual([]);
  });

  it("skips a root element that is itself frontmatter or code", () => {
    const root = document.createElement("pre");
    root.className = "frontmatter";
    root.textContent = "summary: [TK: a]";
    decorateTKs(root);
    expect(chips(root)).toEqual([]);
  });

  it("does not bracket-count a code element inside the body", () => {
    const root = render("<p>[TK: use <code>a]</code> here] tail</p>");
    expect(chips(root)).toEqual(["[TK: use a] here]"]);
  });

  it("does not span a line break or a block", () => {
    expect(chips(render("<p>[TK: start<br>end]</p>"))).toEqual([]);
    expect(chips(render("<p>[TK: start\nend]</p>"))).toEqual([]);
    expect(chips(render("<li>[TK: start<ul><li>end]</li></ul></li>"))).toEqual(
      [],
    );
  });

  it("ignores lookalikes and unbalanced forms", () => {
    expect(chips(render("<p>[TKO] [TK-1] [TKs: x] [tk] [TK: open</p>"))).toEqual(
      [],
    );
  });

  it("leaves a real link named TK alone", () => {
    const root = render('<p><a class="internal-link" href="TK">TK</a></p>');
    expect(chips(root)).toEqual([]);
    expect(root.querySelector("a")?.textContent).toBe("TK");
  });

  it("is idempotent", () => {
    const root = render('<p>[TK: a <a href="x">x</a> b]</p>');
    const once = root.innerHTML;
    decorateTKs(root);
    expect(root.innerHTML).toBe(once);
  });

  it("does not leave empty text nodes in the chip", () => {
    const root = render("<p>[TK]</p>");
    const chip = root.querySelector(".tk-chip")!;
    expect(chip.childNodes).toHaveLength(3);
  });

  describe("links with no destination", () => {
    it("turns one into a chip", () => {
      const root = render('<p>Read <a href="">TK: link to the post</a> now</p>');
      expect(chips(root)).toEqual(["[TK: link to the post]"]);
      expect(root.querySelector("a")).toBeNull();
      expect(root.querySelector(".tk-label")?.textContent).toBe("TK:");
    });

    it("handles a missing href and a bare form", () => {
      expect(chips(render("<p><a>TK: a</a></p>"))).toEqual(["[TK: a]"]);
      expect(chips(render('<p><a href="">TK</a></p>'))).toEqual(["[TK]"]);
    });

    it("keeps formatting inside the link text", () => {
      const root = render('<p><a href="">TK: a <em>b</em> c</a></p>');
      expect(chips(root)).toEqual(["[TK: a b c]"]);
      expect(root.querySelector(".tk-chip em")?.textContent).toBe("b");
    });

    it("leaves other empty links alone", () => {
      const root = render('<p><a href="">Tokyo</a> <a href="">TKO</a></p>');
      expect(chips(root)).toEqual([]);
      expect(root.querySelectorAll("a")).toHaveLength(2);
    });
  });

  describe("escaped source", () => {
    it("skips forms the source escaped", () => {
      const source = "\\[TK: docs] and [TK: real]";
      const root = render(
        "<p>[TK: docs] and [TK: real]</p>",
        tkVisibility(source),
      );
      expect(chips(root)).toEqual(["[TK: real]"]);
    });

    it("counts forms across elements", () => {
      const source = "[TK: a [[x]] b] \\[TK] **[TK]**";
      const root = render(
        '<p>[TK: a <a href="x">x</a> b] [TK] <strong>[TK]</strong></p>',
        tkVisibility(source),
      );
      expect(chips(root)).toEqual(["[TK: a x b]", "[TK]"]);
      expect(root.querySelector("strong .tk-chip")).not.toBeNull();
    });

    it("treats everything as real when there is no source", () => {
      expect(chips(render("<p>[TK]</p>", undefined))).toEqual(["[TK]"]);
    });
  });
});

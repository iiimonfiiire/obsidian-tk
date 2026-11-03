/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const sources = readdirSync("src").map((name) => ({
  name,
  text: readFileSync(join("src", name), "utf8"),
}));

describe("mobile safety", () => {
  it("is declared usable on mobile", () => {
    expect(manifest.isDesktopOnly).toBe(false);
  });

  it("has a valid id", () => {
    expect(manifest.id).toBe("tk-comments");
    expect(manifest.id).not.toContain("obsidian");
  });

  it.each(sources)("$name has no lookbehind regex", ({ text }) => {
    expect(text).not.toMatch(/\(\?<[=!]/);
  });

  it.each(sources)("$name has no Node or Electron APIs", ({ text }) => {
    expect(text).not.toMatch(/from\s+"(node:|fs|path|os|electron|child_process)/);
    expect(text).not.toMatch(/\brequire\(/);
    expect(text).not.toMatch(/\bprocess\./);
  });

  it("keeps the parser free of Obsidian imports", () => {
    for (const name of [
      "parser.ts",
      "insert.ts",
      "reading.ts",
      "tk-index.ts",
      "editor.ts",
      "reveal.ts",
      "panel-model.ts",
      "settings-model.ts",
      "status.ts",
    ]) {
      const source = sources.find((file) => file.name === name);
      expect(source?.text).not.toMatch(/from\s+"obsidian"/);
    }
  });
});

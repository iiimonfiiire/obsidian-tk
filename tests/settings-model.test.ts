/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLORS,
  appearanceCss,
  emptyAppearance,
  isValidColor,
  isValidFontFamily,
  isValidFontSize,
  isValidLength,
  normalizeSettings,
} from "../src/settings-model";

describe("normalizeSettings", () => {
  it("gives defaults for nothing at all", () => {
    for (const raw of [null, undefined, "text", 3, []]) {
      expect(normalizeSettings(raw)).toEqual({
        excludedFolders: ["Archive"],
        appearance: emptyAppearance(),
      });
    }
  });

  it("migrates an older data.json, keeping its folders", () => {
    expect(normalizeSettings({ excludedFolders: ["Old", "Drafts/x"] })).toEqual({
      excludedFolders: ["Old", "Drafts/x"],
      appearance: emptyAppearance(),
    });
  });

  it("keeps an explicitly empty folder list", () => {
    expect(normalizeSettings({ excludedFolders: [] }).excludedFolders).toEqual(
      [],
    );
  });

  it("drops non-string folders and a non-list value", () => {
    expect(
      normalizeSettings({ excludedFolders: ["a", 1, null] }).excludedFolders,
    ).toEqual(["a"]);
    expect(normalizeSettings({ excludedFolders: "a" }).excludedFolders).toEqual([
      "Archive",
    ]);
  });

  it("fills in missing keys of a partial appearance", () => {
    const { appearance } = normalizeSettings({
      appearance: { dark: { commentFill: "#112233" }, paddingY: "2px" },
    });
    expect(appearance.dark.commentFill).toBe("#112233");
    expect(appearance.dark.commentText).toBe("");
    expect(appearance.light).toEqual(emptyAppearance().light);
    expect(appearance.paddingY).toBe("2px");
    expect(appearance.fontSize).toBe("");
  });

  it("discards invalid values rather than failing", () => {
    const { appearance } = normalizeSettings({
      appearance: {
        dark: { commentFill: "red; } body { display: none", commentText: 5 },
        light: "nope",
        paddingY: "calc(1px)",
        fontWeight: "bold",
      },
    });
    expect(appearance).toEqual(emptyAppearance());
  });

  it("does not share state between results", () => {
    const first = normalizeSettings(null);
    first.appearance.dark.commentFill = "#000000";
    expect(normalizeSettings(null).appearance.dark.commentFill).toBe("");
  });
});

describe("validators", () => {
  it.each(["#abc", "#AABBCC", "#012345"])("accepts color %s", (value) => {
    expect(isValidColor(value)).toBe(true);
  });

  it.each(["red", "#ab", "#abcd", "rgb(1,2,3)", "#abc;"])(
    "rejects color %s",
    (value) => {
      expect(isValidColor(value)).toBe(false);
    },
  );

  it.each(["0", "2px", "0.2em", ".5rem"])("accepts length %s", (value) => {
    expect(isValidLength(value)).toBe(true);
  });

  it.each(["", "2", "-1px", "1px 2px", "calc(1px)", "2px;"])(
    "rejects length %s",
    (value) => {
      expect(isValidLength(value)).toBe(false);
    },
  );

  it("accepts font sizes in percent, and rejects zero", () => {
    expect(isValidFontSize("90%")).toBe(true);
    expect(isValidFontSize("0.9em")).toBe(true);
    expect(isValidFontSize("0")).toBe(false);
  });

  it("accepts font lists and rejects anything that could end a rule", () => {
    expect(isValidFontFamily("Inter, 'Helvetica Neue', sans-serif")).toBe(true);
    expect(isValidFontFamily("Inter; } body { display: none")).toBe(false);
    expect(isValidFontFamily("url(x)")).toBe(false);
    expect(isValidFontFamily("</style>")).toBe(false);
    expect(isValidFontFamily("x".repeat(201))).toBe(false);
  });
});

describe("appearanceCss", () => {
  it("is empty by default, so styles.css stays in charge", () => {
    expect(appearanceCss(emptyAppearance())).toBe("");
  });

  it("scopes colors to their theme", () => {
    const appearance = emptyAppearance();
    appearance.dark.commentFill = "#111111";
    appearance.light.responseText = "#222222";
    const css = appearanceCss(appearance);
    expect(css).toContain("body.theme-dark { --tk-chip-fill: #111111; }");
    expect(css).toContain(
      "body.theme-light { --tk-chip-response-text: #222222; }",
    );
  });

  it("applies padding and font to both themes", () => {
    const appearance = emptyAppearance();
    appearance.paddingX = "3px";
    appearance.paddingY = "1px";
    appearance.fontFamily = "Inter";
    appearance.fontSize = "90%";
    appearance.fontWeight = "600";
    expect(appearanceCss(appearance)).toBe(
      "body.theme-dark, body.theme-light { --tk-chip-padding-y: 1px; --tk-chip-bleed: 3px; --tk-chip-font-family: Inter; --tk-chip-font-size: 90%; --tk-chip-font-weight: 600; }",
    );
  });

  it("will not write a value that fails validation", () => {
    const appearance = emptyAppearance();
    appearance.dark.commentFill = "#111; } body { display: none";
    appearance.fontFamily = "x; } a { color: red";
    expect(appearanceCss(appearance)).toBe("");
  });
});

describe("status colors", () => {
  it("are per theme and fill in when missing", () => {
    const { appearance } = normalizeSettings({
      appearance: { dark: { acceptedFill: "#112233" } },
    });
    expect(appearance.dark.acceptedFill).toBe("#112233");
    expect(appearance.dark.rejectedFill).toBe("");
    expect(appearanceCss(appearance)).toBe(
      "body.theme-dark { --tk-chip-accepted-fill: #112233; }",
    );
  });
});

describe("DEFAULT_COLORS", () => {
  const css = readFileSync("styles.css", "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  const VARIABLES: Record<keyof typeof DEFAULT_COLORS.dark, string> = {
    commentFill: "--tk-chip-fill",
    commentText: "--tk-chip-text",
    responseFill: "--tk-chip-response-fill",
    responseText: "--tk-chip-response-text",
    acceptedFill: "--tk-chip-accepted-fill",
    acceptedText: "--tk-chip-accepted-text",
    acceptedResponseFill: "--tk-chip-accepted-response-fill",
    acceptedResponseText: "--tk-chip-accepted-response-text",
    rejectedFill: "--tk-chip-rejected-fill",
    rejectedText: "--tk-chip-rejected-text",
    rejectedResponseFill: "--tk-chip-rejected-response-fill",
    rejectedResponseText: "--tk-chip-rejected-response-text",
  };

  it("matches styles.css", () => {
    const light = block("body");
    const dark = block(".theme-dark");
    for (const key of Object.keys(VARIABLES) as (keyof typeof VARIABLES)[]) {
      expect(light).toContain(`${VARIABLES[key]}: ${DEFAULT_COLORS.light[key]};`);
      expect(dark).toContain(`${VARIABLES[key]}: ${DEFAULT_COLORS.dark[key]};`);
    }
  });
});

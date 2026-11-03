export interface ChipColors {
  commentFill: string;
  commentText: string;
  responseFill: string;
  responseText: string;
}

export interface Appearance {
  dark: ChipColors;
  light: ChipColors;
  paddingY: string;
  paddingX: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}

export interface TKSettings {
  excludedFolders: string[];
  appearance: Appearance;
}

/** Mirrors the defaults in styles.css, for the color pickers to show. */
export const DEFAULT_COLORS: { dark: ChipColors; light: ChipColors } = {
  dark: {
    commentFill: "#b45309",
    commentText: "#ffffff",
    responseFill: "#7c2d12",
    responseText: "#ffffff",
  },
  light: {
    commentFill: "#f5b041",
    commentText: "#2a1700",
    responseFill: "#fcdca6",
    responseText: "#2a1700",
  },
};

export const FONT_WEIGHTS = ["300", "400", "500", "600", "700", "800"];

const COLOR_KEYS: (keyof ChipColors)[] = [
  "commentFill",
  "commentText",
  "responseFill",
  "responseText",
];

const COLOR_VARIABLES: Record<keyof ChipColors, string> = {
  commentFill: "--tk-chip-fill",
  commentText: "--tk-chip-text",
  responseFill: "--tk-chip-response-fill",
  responseText: "--tk-chip-response-text",
};

const emptyColors = (): ChipColors => ({
  commentFill: "",
  commentText: "",
  responseFill: "",
  responseText: "",
});

export const emptyAppearance = (): Appearance => ({
  dark: emptyColors(),
  light: emptyColors(),
  paddingY: "",
  paddingX: "",
  fontFamily: "",
  fontSize: "",
  fontWeight: "",
});

export function isValidColor(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

export function isValidLength(value: string): boolean {
  return /^(?:\d+|\d*\.\d+)(?:em|rem|px)$/.test(value) || value === "0";
}

export function isValidFontSize(value: string): boolean {
  return value !== "0" && (isValidLength(value) || /^(?:\d+|\d*\.\d+)%$/.test(value));
}

export function isValidFontFamily(value: string): boolean {
  return value.length <= 200 && /^[\w\s,'"-]+$/.test(value);
}

function clean(raw: unknown, isValid: (value: string) => boolean): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return isValid(value) ? value : "";
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function normalizeColors(raw: unknown): ChipColors {
  const record = asRecord(raw);
  const colors = emptyColors();
  for (const key of COLOR_KEYS) colors[key] = clean(record[key], isValidColor);
  return colors;
}

/** Accepts anything data.json might hold. Missing or invalid keys take defaults. */
export function normalizeSettings(raw: unknown): TKSettings {
  const record = asRecord(raw);
  const appearance = asRecord(record.appearance);
  return {
    excludedFolders: Array.isArray(record.excludedFolders)
      ? record.excludedFolders.filter(
          (folder): folder is string => typeof folder === "string",
        )
      : ["Archive"],
    appearance: {
      dark: normalizeColors(appearance.dark),
      light: normalizeColors(appearance.light),
      paddingY: clean(appearance.paddingY, isValidLength),
      paddingX: clean(appearance.paddingX, isValidLength),
      fontFamily: clean(appearance.fontFamily, isValidFontFamily),
      fontSize: clean(appearance.fontSize, isValidFontSize),
      fontWeight: clean(appearance.fontWeight, (v) => FONT_WEIGHTS.includes(v)),
    },
  };
}

function declarations(entries: [string, string][]): string {
  return entries
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}

function rule(selector: string, entries: [string, string][]): string {
  const body = declarations(entries);
  return body === "" ? "" : `${selector} { ${body} }`;
}

function colorEntries(colors: ChipColors): [string, string][] {
  return COLOR_KEYS.map((key) => [COLOR_VARIABLES[key], colors[key]]);
}

/**
 * Selectors outrank the plain body and .theme-dark rules in styles.css. Values
 * come through normalizeSettings first, so none can break out of a declaration.
 */
export function appearanceCss(raw: Appearance): string {
  const a = normalizeSettings({ appearance: raw }).appearance;
  return [
    rule("body.theme-dark", colorEntries(a.dark)),
    rule("body.theme-light", colorEntries(a.light)),
    rule("body.theme-dark, body.theme-light", [
      ["--tk-chip-padding-y", a.paddingY],
      ["--tk-chip-bleed", a.paddingX],
      ["--tk-chip-font-family", a.fontFamily],
      ["--tk-chip-font-size", a.fontSize],
      ["--tk-chip-font-weight", a.fontWeight],
    ]),
  ]
    .filter((text) => text !== "")
    .join("\n");
}

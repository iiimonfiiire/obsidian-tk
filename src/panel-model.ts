import { displayText, type TK } from "./parser";
import type { FileTKs } from "./tk-index";

export function noteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function textMatches(text: string, query: string): boolean {
  return (
    text.toLowerCase().includes(query) ||
    displayText(text).toLowerCase().includes(query)
  );
}

function tkMatches(tk: TK, query: string): boolean {
  return (
    textMatches(tk.body, query) ||
    (tk.response !== null && textMatches(tk.response, query))
  );
}

export function filterFiles(files: FileTKs[], query: string): FileTKs[] {
  const needle = normalizeQuery(query);
  if (needle === "") return files;
  const matches: FileTKs[] = [];
  for (const file of files) {
    if (noteName(file.path).toLowerCase().includes(needle)) {
      matches.push(file);
      continue;
    }
    const tks = file.tks.filter((tk) => tkMatches(tk, needle));
    if (tks.length > 0) matches.push({ path: file.path, tks });
  }
  return matches;
}

export function countTKs(files: FileTKs[]): number {
  return files.reduce((sum, file) => sum + file.tks.length, 0);
}

export function isGroupCollapsed(
  path: string,
  collapsed: ReadonlySet<string>,
  query: string,
): boolean {
  return normalizeQuery(query) === "" && collapsed.has(path);
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function vaultCountLabel(
  all: FileTKs[],
  shown: FileTKs[],
  query: string,
): string {
  const total = countTKs(all);
  if (total === 0) return "";
  if (normalizeQuery(query) === "") {
    return `${total} open in ${plural(all.length, "note")}`;
  }
  return `${countTKs(shown)} of ${total} in ${shown.length} of ${plural(all.length, "note")}`;
}

export function noteCountLabel(
  total: number,
  shown: number,
  query: string,
): string {
  if (normalizeQuery(query) === "" || total === 0) return `${total} open`;
  return `${shown} of ${total} open`;
}

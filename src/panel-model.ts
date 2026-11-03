import { displayText, type TK, type TKStatus } from "./parser";
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

export type StatusFilter = "queue" | TKStatus | "all";

export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "open", label: "Open" },
  { id: "responded", label: "Responded" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

export function isStatusFilter(value: unknown): value is StatusFilter {
  return STATUS_FILTERS.some(({ id }) => id === value);
}

export function matchesFilter(tk: TK, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "queue") return tk.status === "open" || tk.status === "responded";
  return tk.status === filter;
}

export function filterByStatus(
  files: FileTKs[],
  filter: StatusFilter,
): FileTKs[] {
  if (filter === "all") return files;
  const matches: FileTKs[] = [];
  for (const file of files) {
    const tks = file.tks.filter((tk) => matchesFilter(tk, filter));
    if (tks.length > 0) matches.push({ path: file.path, tks });
  }
  return matches;
}

export function countsByFilter(files: FileTKs[]): Record<StatusFilter, number> {
  const counts = {} as Record<StatusFilter, number>;
  for (const { id } of STATUS_FILTERS) {
    counts[id] = countTKs(filterByStatus(files, id));
  }
  return counts;
}

/** The queue count ignores search and the chosen filter: it's the number to clear. */
export function headerLabel(
  all: FileTKs[],
  shown: FileTKs[],
  filter: StatusFilter,
  query: string,
): string {
  const queue = `${countTKs(filterByStatus(all, "queue"))} in queue`;
  return filter === "queue" && normalizeQuery(query) === ""
    ? queue
    : `${queue} · showing ${countTKs(shown)}`;
}

export interface EmptyState {
  title: string;
  detail?: string;
}

export function emptyState(
  filter: StatusFilter,
  scope: "note" | "vault",
  query: string,
): EmptyState {
  const where = scope === "note" ? "this note" : "the vault";
  const needle = query.trim();
  const label = filter === "all" ? "" : `${filter} `;
  if (needle !== "") {
    return filter === "queue"
      ? { title: `Nothing in the queue matches "${needle}".` }
      : { title: `No ${label}TKs match "${needle}".` };
  }
  if (filter === "queue") {
    return { title: "Queue clear.", detail: `Nothing waiting in ${where}.` };
  }
  return { title: `No ${label}TKs in ${where}.` };
}

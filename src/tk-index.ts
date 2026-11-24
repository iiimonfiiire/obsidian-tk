import { findTKs, type TK } from "./parser";

export interface VaultSource {
  list(): { path: string; mtime: number }[];
  read(path: string): Promise<string>;
  mtime(path: string): number | null;
}

export interface FileTKs {
  path: string;
  tks: TK[];
}

type Reader = () => string | Promise<string>;

const READ_BATCH = 32;
const UNSAVED = -1;

export function normalizeFolders(folders: string[]): string[] {
  const clean = folders
    .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ""))
    .filter((folder) => folder !== "");
  return Array.from(new Set(clean));
}

export function isInFolders(path: string, folders: string[]): boolean {
  return folders.some(
    (folder) => path === folder || path.startsWith(`${folder}/`),
  );
}

export function locateTK(tks: TK[], target: TK): TK | null {
  let best: TK | null = null;
  for (const tk of tks) {
    if (tk.raw !== target.raw) continue;
    if (
      !best ||
      Math.abs(tk.start - target.start) < Math.abs(best.start - target.start)
    ) {
      best = tk;
    }
  }
  return best;
}

export class TKIndex {
  ready = false;

  private entries = new Map<string, { mtime: number; tks: TK[] }>();
  private generations = new Map<string, number>();
  private dirty = new Map<string, Reader>();
  private timer: number | null = null;
  private changed = false;
  private started = false;
  private syncing = false;
  private syncAgain = false;
  private excluded: string[];

  constructor(
    private source: VaultSource,
    excluded: string[],
    private onChange: () => void,
    private debounceMs = 300,
  ) {
    this.excluded = normalizeFolders(excluded);
  }

  isExcluded(path: string): boolean {
    return isInFolders(path, this.excluded);
  }

  setExcluded(folders: string[]): void {
    this.excluded = normalizeFolders(folders);
    if (this.started) void this.sync();
  }

  get(path: string): TK[] {
    return this.entries.get(path)?.tks ?? [];
  }

  all(): FileTKs[] {
    const files: FileTKs[] = [];
    this.entries.forEach((entry, path) => {
      if (entry.tks.length > 0) files.push({ path, tks: entry.tks });
    });
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async sync(): Promise<void> {
    this.started = true;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        await this.reconcile();
      } while (this.syncAgain);
      this.ready = true;
      this.onChange();
    } finally {
      this.syncing = false;
    }
  }

  schedule(path: string, reader?: Reader): void {
    if (!this.started || this.isExcluded(path)) return;
    this.dirty.set(path, reader ?? (() => this.source.read(path)));
    this.arm();
  }

  remove(path: string): void {
    this.bump(path);
    this.dirty.delete(path);
    if (this.entries.delete(path)) {
      this.changed = true;
      this.arm();
    }
  }

  rename(oldPath: string, newPath: string): void {
    const entry = this.entries.get(oldPath);
    this.remove(oldPath);
    if (!this.started || this.isExcluded(newPath)) return;
    this.bump(newPath);
    if (entry) {
      this.entries.set(newPath, entry);
      this.changed = true;
      this.arm();
    } else {
      this.schedule(newPath);
    }
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.dirty.clear();
    this.started = false;
  }

  private bump(path: string): number {
    const next = (this.generations.get(path) ?? 0) + 1;
    this.generations.set(path, next);
    return next;
  }

  private arm(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    const pending = Array.from(this.dirty.entries());
    this.dirty.clear();
    await Promise.all(
      pending.map(async ([path, reader]) => {
        if (await this.load(path, reader)) this.changed = true;
      }),
    );
    if (this.changed) {
      this.changed = false;
      if (this.started) this.onChange();
    }
  }

  private async load(
    path: string,
    reader: Reader,
    knownMtime?: number,
  ): Promise<boolean> {
    const generation = this.bump(path);
    try {
      const content = await reader();
      if (this.generations.get(path) !== generation) return false;
      const mtime = knownMtime ?? this.source.mtime(path) ?? UNSAVED;
      this.entries.set(path, { mtime, tks: findTKs(content) });
      return true;
    } catch {
      if (this.generations.get(path) !== generation) return false;
      return this.entries.delete(path);
    }
  }

  private async reconcile(): Promise<void> {
    const present = new Set<string>();
    const stale: { path: string; mtime: number }[] = [];
    for (const file of this.source.list()) {
      if (this.isExcluded(file.path)) continue;
      present.add(file.path);
      if (this.entries.get(file.path)?.mtime !== file.mtime) stale.push(file);
    }
    Array.from(this.entries.keys()).forEach((path) => {
      if (!present.has(path)) {
        this.bump(path);
        this.entries.delete(path);
      }
    });
    for (let i = 0; i < stale.length; i += READ_BATCH) {
      await Promise.all(
        stale.slice(i, i + READ_BATCH).map(({ path, mtime }) =>
          this.load(path, () => this.source.read(path), mtime),
        ),
      );
    }
  }
}

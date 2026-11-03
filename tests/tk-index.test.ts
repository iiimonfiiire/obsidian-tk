import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TKIndex,
  isInFolders,
  locateTK,
  normalizeFolders,
  type VaultSource,
} from "../src/tk-index";
import { findTKs } from "../src/parser";

function fakeVault(files: Record<string, string>) {
  const store = new Map(
    Object.entries(files).map(([path, text]) => [path, { text, mtime: 1 }]),
  );
  const read = vi.fn(async (path: string) => {
    const file = store.get(path);
    if (!file) throw new Error("missing");
    return file.text;
  });
  const source: VaultSource = {
    list: () =>
      Array.from(store, ([path, file]) => ({ path, mtime: file.mtime })),
    read,
    mtime: (path) => store.get(path)?.mtime ?? null,
  };
  const write = (path: string, text: string) => {
    const mtime = (store.get(path)?.mtime ?? 0) + 1;
    store.set(path, { text, mtime });
  };
  const drop = (path: string) => store.delete(path);
  const move = (from: string, to: string) => {
    const file = store.get(from);
    if (file) store.set(to, file);
    store.delete(from);
  };
  return { source, read, write, drop, move };
}

describe("folder helpers", () => {
  it("normalizes folder entries", () => {
    expect(normalizeFolders([" Archive/ ", "", "/a/b/", "Archive"])).toEqual([
      "Archive",
      "a/b",
    ]);
  });

  it("matches whole path segments from the root", () => {
    expect(isInFolders("Archive/x.md", ["Archive"])).toBe(true);
    expect(isInFolders("Archive2/x.md", ["Archive"])).toBe(false);
    expect(isInFolders("Notes/Archive/x.md", ["Archive"])).toBe(false);
    expect(isInFolders("a/b/c.md", ["a/b"])).toBe(true);
  });
});

describe("locateTK", () => {
  it("picks the same text nearest the old offset", () => {
    const old = findTKs("x [TK: a] y [TK: a]")[1];
    const shifted = findTKs("longer prefix x [TK: a] y [TK: a]");
    expect(locateTK(shifted, old)?.start).toBe(shifted[0].start);
    expect(locateTK(findTKs("nothing here"), old)).toBeNull();
  });
});

describe("TKIndex", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function settled() {
    await vi.runAllTimersAsync();
  }

  it("skips excluded folders on the initial scan", async () => {
    const vault = fakeVault({
      "a.md": "[TK: one]",
      "Archive/old.md": "[TK: old]",
      "b.md": "nothing",
    });
    const onChange = vi.fn();
    const index = new TKIndex(vault.source, ["Archive"], onChange);
    await index.sync();

    expect(index.ready).toBe(true);
    expect(index.all().map((file) => file.path)).toEqual(["a.md"]);
    expect(vault.read).not.toHaveBeenCalledWith("Archive/old.md");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("sorts groups by path", async () => {
    const vault = fakeVault({ "z.md": "[TK]", "a/b.md": "[TK]", "c.md": "[TK]" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();
    expect(index.all().map((file) => file.path)).toEqual([
      "a/b.md",
      "c.md",
      "z.md",
    ]);
  });

  it("debounces per file and reads only the changed file", async () => {
    const vault = fakeVault({ "a.md": "[TK: a]", "b.md": "[TK: b]" });
    const onChange = vi.fn();
    const index = new TKIndex(vault.source, [], onChange);
    await index.sync();
    vault.read.mockClear();
    onChange.mockClear();

    vault.write("a.md", "[TK: a] [TK: a2]");
    for (let i = 0; i < 10; i++) {
      index.schedule("a.md");
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(vault.read).not.toHaveBeenCalled();

    await settled();
    expect(vault.read).toHaveBeenCalledTimes(1);
    expect(vault.read).toHaveBeenCalledWith("a.md");
    expect(index.get("a.md")).toHaveLength(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("uses editor content for unsaved changes", async () => {
    const vault = fakeVault({ "a.md": "no gaps" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();
    vault.read.mockClear();

    index.schedule("a.md", () => "now [TK: unsaved]");
    await settled();
    expect(index.get("a.md")[0].body).toBe("unsaved");
    expect(vault.read).not.toHaveBeenCalled();
  });

  it("drops a TK once the text is gone", async () => {
    const vault = fakeVault({ "a.md": "[TK: a]" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();
    vault.write("a.md", "filled in");
    index.schedule("a.md");
    await settled();
    expect(index.all()).toEqual([]);
  });

  it("ignores events before the first scan and for excluded files", async () => {
    const vault = fakeVault({ "a.md": "[TK]", "Archive/b.md": "[TK]" });
    const index = new TKIndex(vault.source, ["Archive"], () => {});
    index.schedule("a.md");
    await settled();
    expect(vault.read).not.toHaveBeenCalled();

    await index.sync();
    vault.read.mockClear();
    index.schedule("Archive/b.md");
    await settled();
    expect(vault.read).not.toHaveBeenCalled();
  });

  it("handles create, delete and rename", async () => {
    const vault = fakeVault({ "a.md": "[TK: a]" });
    const onChange = vi.fn();
    const index = new TKIndex(vault.source, ["Archive"], onChange);
    await index.sync();

    vault.write("new.md", "[TK: new]");
    index.schedule("new.md");
    await settled();
    expect(index.get("new.md")).toHaveLength(1);

    vault.read.mockClear();
    vault.move("new.md", "moved.md");
    index.rename("new.md", "moved.md");
    await settled();
    expect(index.get("new.md")).toEqual([]);
    expect(index.get("moved.md")).toHaveLength(1);
    expect(vault.read).not.toHaveBeenCalled();

    vault.move("moved.md", "Archive/moved.md");
    index.rename("moved.md", "Archive/moved.md");
    await settled();
    expect(index.all().map((file) => file.path)).toEqual(["a.md"]);

    onChange.mockClear();
    vault.drop("a.md");
    index.remove("a.md");
    await settled();
    expect(index.all()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reads a file renamed out of an excluded folder", async () => {
    const vault = fakeVault({ "Archive/a.md": "[TK: a]" });
    const index = new TKIndex(vault.source, ["Archive"], () => {});
    await index.sync();
    expect(index.all()).toEqual([]);

    vault.move("Archive/a.md", "a.md");
    index.rename("Archive/a.md", "a.md");
    await settled();
    expect(index.get("a.md")).toHaveLength(1);
  });

  it("discards a slow read that a newer change overtook", async () => {
    const vault = fakeVault({ "a.md": "old" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();

    let release: (text: string) => void = () => {};
    index.schedule("a.md", () => new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(400);

    index.schedule("a.md", () => "[TK: newest]");
    await vi.advanceTimersByTimeAsync(400);
    release("[TK: stale]");
    await settled();

    expect(index.get("a.md").map((tk) => tk.body)).toEqual(["newest"]);
  });

  it("does not resurrect a file deleted during a read", async () => {
    const vault = fakeVault({ "a.md": "[TK]" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();

    let release: (text: string) => void = () => {};
    index.schedule("a.md", () => new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(400);
    index.remove("a.md");
    release("[TK]");
    await settled();
    expect(index.all()).toEqual([]);
  });

  it("removes a file that fails to read", async () => {
    const vault = fakeVault({ "a.md": "[TK]" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();
    vault.drop("a.md");
    index.schedule("a.md");
    await settled();
    expect(index.all()).toEqual([]);
  });

  it("rescans only what changed when reconciling", async () => {
    const vault = fakeVault({ "a.md": "[TK]", "b.md": "[TK]" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();
    vault.read.mockClear();

    await index.sync();
    expect(vault.read).not.toHaveBeenCalled();

    vault.write("b.md", "[TK] [TK]");
    vault.drop("a.md");
    await index.sync();
    expect(vault.read).toHaveBeenCalledTimes(1);
    expect(index.all().map((file) => [file.path, file.tks.length])).toEqual([
      ["b.md", 2],
    ]);
  });

  it("applies new exclusions without re-reading kept files", async () => {
    const vault = fakeVault({ "a.md": "[TK]", "Private/b.md": "[TK]" });
    const index = new TKIndex(vault.source, [], () => {});
    await index.sync();
    vault.read.mockClear();

    index.setExcluded(["Private"]);
    await settled();
    expect(index.all().map((file) => file.path)).toEqual(["a.md"]);
    expect(vault.read).not.toHaveBeenCalled();

    index.setExcluded([]);
    await settled();
    expect(index.all()).toHaveLength(2);
    expect(vault.read).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling after destroy", async () => {
    const vault = fakeVault({ "a.md": "[TK]" });
    const onChange = vi.fn();
    const index = new TKIndex(vault.source, [], onChange);
    await index.sync();
    onChange.mockClear();
    vault.read.mockClear();

    index.schedule("a.md");
    index.destroy();
    index.schedule("a.md");
    await settled();
    expect(vault.read).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

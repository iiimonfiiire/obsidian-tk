import type { TK } from "./parser";

export interface RevealTarget {
  line: number;
  ch: number;
  raw: string;
}

/**
 * Ephemeral state for leaf.openFile. Obsidian applies it once the view has its
 * content, which a scroll call after openFile resolves can't rely on.
 * Editing mode scrolls to startLoc/endLoc. Reading mode scrolls to line.
 */
export function revealState(tk: RevealTarget, focus: boolean) {
  const range = selectionRange(tk);
  return {
    focus,
    line: tk.line,
    startLoc: { line: range.from.line, col: range.from.ch },
    endLoc: { line: range.to.line, col: range.to.ch },
  };
}

/** Applied after opening, because Obsidian's scroll highlight clears a selection. */
export function selectionRange(tk: RevealTarget) {
  return {
    from: { line: tk.line, ch: tk.ch },
    to: { line: tk.line, ch: tk.ch + tk.raw.length },
  };
}

export function toTarget(tk: TK): RevealTarget {
  return { line: tk.line, ch: tk.ch, raw: tk.raw };
}

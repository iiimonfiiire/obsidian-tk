import { findTKs, type TK } from "./parser";

export type TargetStatus = "open" | "accepted" | "rejected";

const PREFIX: Record<TargetStatus, string> = {
  open: "[TK:",
  accepted: "[TK accepted:",
  rejected: "[TK rejected:",
};

/** Identifies a TK among identical twins: its text, and which occurrence it is. */
export interface TKRef {
  raw: string;
  ordinal: number;
  total: number;
}

export function refOf(tks: readonly TK[], tk: TK): TKRef {
  const twins = tks.filter((other) => other.raw === tk.raw);
  return {
    raw: tk.raw,
    ordinal: twins.findIndex((other) => other.start === tk.start),
    total: twins.length,
  };
}

export type Relocated =
  | { ok: true; tk: TK }
  | { ok: false; reason: "gone" | "ambiguous" };

/**
 * Stricter than locateTK, which picks the nearest match and suits navigation. A
 * write must not guess: if twins were added or removed, which one is which is
 * unknowable, so it refuses.
 */
export function relocate(tks: readonly TK[], ref: TKRef): Relocated {
  const twins = tks.filter((tk) => tk.raw === ref.raw);
  if (twins.length === 0) return { ok: false, reason: "gone" };
  if (twins.length !== ref.total || ref.ordinal < 0) {
    return { ok: false, reason: "ambiguous" };
  }
  return { ok: true, tk: twins[ref.ordinal] };
}

export interface PrefixEdit {
  from: number;
  to: number;
  insert: string;
}

export type PlannedEdit =
  | { ok: true; edit: PrefixEdit }
  | { ok: false; reason: "gone" | "ambiguous" };

/** Touches only the prefix, so the comment and response stay byte for byte. */
export function planStatusEdit(
  text: string,
  ref: TKRef,
  status: TargetStatus,
): PlannedEdit {
  const found = relocate(findTKs(text), ref);
  if (!found.ok) return found;
  const { tk } = found;
  return {
    ok: true,
    edit: {
      from: tk.start,
      to: tk.start + tk.prefixLength,
      insert: PREFIX[status],
    },
  };
}

export function applyEdit(text: string, edit: PrefixEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

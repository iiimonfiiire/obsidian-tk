export interface Insertion {
  text: string;
  cursor: number;
}

export function buildInsertion(selection: string): Insertion {
  const trimmed = selection.trim();
  if (trimmed === "") return { text: "[TK: ]", cursor: 5 };

  const start = selection.indexOf(trimmed);
  const lead = selection.slice(0, start);
  const trail = selection.slice(start + trimmed.length);
  const body = trimmed.replace(/\s*\r?\n\s*/g, " ");
  const tk = `[TK: ${body}]`;
  return {
    text: lead + tk + trail,
    cursor: lead.length + tk.length,
  };
}

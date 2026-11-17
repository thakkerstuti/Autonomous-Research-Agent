/**
 * Pure helpers for a research paper's text, shared by the editor and preview.
 * Body text: paragraphs separated by a blank line; lines starting with "- "
 * form a list; [1] or [1, 3] are citations; **bold** and *italic* are kept.
 * (The PDF on the server follows the same rules.)
 */

export interface NumberedSection<S extends { level: number }> {
  num: string;
  section: S;
}

/** "1.", "2.", "2.1" … the way the PDF numbers headings. */
export function numberSections<S extends { level: number }>(sections: S[]): NumberedSection<S>[] {
  let n1 = 0;
  let n2 = 0;
  return sections.map((section) => {
    if (section.level === 2) {
      n2 += 1;
      return { num: n1 ? `${n1}.${n2}` : `${n2}`, section };
    }
    n1 += 1;
    n2 = 0;
    return { num: `${n1}.`, section };
  });
}

export type Block = { type: "p"; text: string } | { type: "list"; items: string[] };

export function splitBlocks(body: string): Block[] {
  const out: Block[] = [];
  for (const chunk of (body || "").trim().split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      const items = lines.map((l) => l.replace(/^\s*[-*•]\s+/, ""));
      const prev = out[out.length - 1];
      if (prev && prev.type === "list") prev.items.push(...items);
      else out.push({ type: "list", items });
    } else {
      out.push({ type: "p", text: lines.map((l) => l.trim()).join(" ") });
    }
  }
  return out;
}

export type Inline =
  | { type: "text"; text: string }
  | { type: "cite"; numbers: number[] }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string };

const INLINE = /\[(\d+(?:\s*,\s*\d+)*)\]|\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g;

export function splitInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of (text || "").matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    if (m[1]) out.push({ type: "cite", numbers: m[1].split(",").map((n) => parseInt(n.trim(), 10)) });
    else if (m[2]) out.push({ type: "bold", text: m[2] });
    else out.push({ type: "italic", text: m[3] });
    last = at + m[0].length;
  }
  if (last < (text || "").length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function paperWordCount(c: { abstract: string; sections: { heading: string; body: string }[] }): number {
  const all = [c.abstract, ...c.sections.flatMap((s) => [s.heading, s.body])].join(" ");
  return (all.match(/\S+/g) || []).length;
}

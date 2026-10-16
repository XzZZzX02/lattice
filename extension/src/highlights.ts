import { excerptRange } from "./host";
import type { SelectionAnchor } from "../../src/lib/floating";
import type { Excerpt, NativeAnswer } from "./types";

export function linkExcerptHighlights(answers: NativeAnswer[], excerpts: Excerpt[], onOpen: (excerpt: Excerpt, anchor: SelectionAnchor) => void): () => void {
  if (typeof Highlight === "undefined" || !CSS.highlights) return () => {};
  const ranges = excerpts.flatMap((excerpt) => {
    const answer = answers.find((item) => item.id === excerpt.messageId);
    const range = answer ? excerptRange(answer, excerpt) : null;
    return range ? [{ excerpt, range }] : [];
  });
  CSS.highlights.set("lattice-linked-excerpts", new Highlight(...ranges.map((item) => item.range)));
  function clicked(event: MouseEvent) {
    if (event.button !== 0 || event.detail > 1 || !window.getSelection()?.isCollapsed) return;
    if (!(event.target instanceof Element) || event.target.closest("a, button, input, textarea, [contenteditable], [role='button'], #lattice-chatgpt-extension")) return;
    for (const { excerpt, range } of ranges) {
      for (const rect of range.getClientRects()) {
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          onOpen(excerpt, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
          return;
        }
      }
    }
  }
  document.addEventListener("click", clicked);
  return () => { document.removeEventListener("click", clicked); CSS.highlights.delete("lattice-linked-excerpts"); CSS.highlights.delete("lattice-excerpt"); };
}

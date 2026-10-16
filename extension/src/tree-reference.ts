import type { Excerpt } from "./types";
import { excerptRange } from "./host";
import type { TreeCard } from "./tree-types";
import type { SelectionAnchor } from "../../src/lib/floating";

export interface TreeReference { card: TreeCard; container: HTMLElement; range: Range }

export function answerReference(messageId: string, container: HTMLElement): Excerpt {
  const raw = container.textContent ?? "";
  const text = raw.trim().slice(0, 80);
  const startOffset = raw.indexOf(text);
  return { id: crypto.randomUUID(), messageId, text, startOffset, endOffset: startOffset + text.length, note: "", createdAt: new Date().toISOString() };
}

export function resolveTreeReference(card: TreeCard, container: HTMLElement): TreeReference | null {
  const anchor = card.anchor ?? answerReference(card.sourceMessageId, container);
  if (!anchor.text) return null;
  const range = excerptRange({ contentElement: container }, anchor);
  return range ? { card, container, range } : null;
}

export function referenceRect(reference: TreeReference): SelectionAnchor | null {
  const rect = [...reference.range.getClientRects()].find((rect) => rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight);
  return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
}

export function linkTreeReferences(references: TreeReference[], activeId: string | undefined, open: (card: TreeCard) => void) {
  const registry = typeof CSS === "undefined" ? undefined : CSS.highlights;
  if (typeof Highlight !== "undefined" && registry) {
    registry.set("lattice-tree-references", new Highlight(...references.map((item) => item.range)));
    registry.set("lattice-tree-active-reference", new Highlight(...references.filter((item) => item.card.id === activeId).map((item) => item.range)));
  }
  function clicked(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.detail > 1) return;
    const element = event.composedPath().find((item): item is HTMLElement => item instanceof HTMLElement);
    if (!element || element.closest("a, button, input, textarea, [contenteditable], [role='button']")) return;
    const root = element.getRootNode() as Document | (ShadowRoot & { getSelection?: () => Selection });
    const selection = root.getSelection?.() ?? window.getSelection();
    if (selection && !selection.isCollapsed) return;
    // Match only the clicked text container, never a rectangle behind a popover.
    // Prefer the narrower reference if two saved selections overlap.
    const ordered = [...references].sort((a, b) => a.range.toString().length - b.range.toString().length);
    const match = ordered.find((item) => item.container.contains(element) && [...item.range.getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
    if (match) { event.preventDefault(); open(match.card); }
  }
  document.addEventListener("click", clicked, true);
  return () => {
    document.removeEventListener("click", clicked, true);
    registry?.delete("lattice-tree-references");
    registry?.delete("lattice-tree-active-reference");
  };
}

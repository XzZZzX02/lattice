import type { SelectionAnchor } from "../../src/lib/floating";

export function positionTreeCard(anchor: SelectionAnchor, viewport: { width: number; height: number; right?: number }, measuredHeight = 460) {
  const margin = 12;
  const gap = 12;
  const right = Math.min(viewport.width, Math.max(Math.min(margin + 240, viewport.width), viewport.right ?? viewport.width));
  const width = Math.max(0, Math.min(420, right - margin * 2));
  let maxHeight = Math.max(0, Math.min(560, viewport.height - margin * 2));
  const height = Math.min(measuredHeight, maxHeight);
  const clampX = (left: number) => Math.max(margin, Math.min(left, right - width - margin));
  const clampY = (top: number) => Math.max(margin, Math.min(top, viewport.height - height - margin));
  if (anchor.right + gap + width <= right - margin) return { left: clampX(anchor.right + gap), top: clampY(anchor.top - 24), width, maxHeight };
  if (anchor.left - gap - width >= margin) return { left: clampX(anchor.left - gap - width), top: clampY(anchor.top - 24), width, maxHeight };
  const below = anchor.bottom + gap;
  const belowSpace = viewport.height - margin - below;
  const aboveSpace = anchor.top - gap - margin;
  // On a narrow screen, shorten the scrollable history rather than covering
  // the referenced word with a full-height popover.
  if (belowSpace >= Math.min(280, maxHeight)) { maxHeight = Math.min(maxHeight, belowSpace); return { left: clampX(anchor.left), top: below, width, maxHeight }; }
  if (aboveSpace >= Math.min(280, maxHeight)) { maxHeight = Math.min(maxHeight, aboveSpace); return { left: clampX(anchor.left), top: clampY(anchor.top - gap - Math.min(measuredHeight, maxHeight)), width, maxHeight }; }
  const top = below + height <= viewport.height - margin ? below : anchor.top - gap - height >= margin ? anchor.top - gap - height : clampY(below);
  return { left: clampX(anchor.left), top, width, maxHeight };
}

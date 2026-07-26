import type { SelectionCardLink } from "../types";

export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export function applySelectionHighlights(
  tree: HastNode,
  links: SelectionCardLink[]
): void {
  const visibleText = collectText(tree);
  const validLinks = links
    .filter((link) =>
      link.startOffset >= 0
      && link.endOffset > link.startOffset
      && visibleText.slice(link.startOffset, link.endOffset) === link.selectedText
    )
    .sort((left, right) =>
      left.startOffset - right.startOffset || left.endOffset - right.endOffset
    );
  if (validLinks.length === 0) return;

  let visibleOffset = 0;
  transformChildren(tree, validLinks, () => visibleOffset, (value) => {
    visibleOffset = value;
  });
}

function collectText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(collectText).join("") ?? "";
}

function transformChildren(
  node: HastNode,
  links: SelectionCardLink[],
  getOffset: () => number,
  setOffset: (value: number) => void
): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text") {
      transformChildren(child, links, getOffset, setOffset);
      return child;
    }
    const value = child.value ?? "";
    const start = getOffset();
    const end = start + value.length;
    setOffset(end);
    const intersecting = links.filter((link) =>
      link.startOffset < end && link.endOffset > start
    );
    if (intersecting.length === 0) return child;
    return splitTextNode(value, start, intersecting);
  });
}

function splitTextNode(
  value: string,
  globalStart: number,
  links: SelectionCardLink[]
): HastNode[] {
  const boundaries = new Set([0, value.length]);
  for (const link of links) {
    boundaries.add(clamp(link.startOffset - globalStart, 0, value.length));
    boundaries.add(clamp(link.endOffset - globalStart, 0, value.length));
  }
  const points = [...boundaries].sort((left, right) => left - right);
  const output: HastNode[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const localStart = points[index];
    const localEnd = points[index + 1];
    if (localStart === localEnd) continue;
    const text = value.slice(localStart, localEnd);
    const segmentStart = globalStart + localStart;
    const segmentEnd = globalStart + localEnd;
    const link = links.find((candidate) =>
      candidate.startOffset <= segmentStart && candidate.endOffset >= segmentEnd
    );
    output.push(link ? markedText(text, link.id) : { type: "text", value: text });
  }
  return output;
}

function markedText(value: string, linkId: string): HastNode {
  return {
    type: "element",
    tagName: "mark",
    properties: {
      className: ["selection-card-mark"],
      "data-selection-link-id": linkId
    },
    children: [{ type: "text", value }]
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

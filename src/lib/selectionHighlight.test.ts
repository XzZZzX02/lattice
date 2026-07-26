import { describe, expect, it } from "vitest";
import type { SelectionCardLink } from "../types";
import { applySelectionHighlights } from "./selectionHighlight";

function link(overrides: Partial<SelectionCardLink> = {}): SelectionCardLink {
  return {
    id: "link-1",
    sourceTurnId: "turn-1",
    targetCardId: "card-2",
    selectedText: "beta",
    startOffset: 6,
    endOffset: 10,
    createdAt: "",
    ...overrides
  };
}

describe("applySelectionHighlights", () => {
  it("marks linked visible text across Markdown element boundaries", () => {
    const tree = {
      type: "root",
      children: [{
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          { type: "text", value: "Alpha " },
          {
            type: "element",
            tagName: "strong",
            properties: {},
            children: [{ type: "text", value: "beta" }]
          },
          { type: "text", value: " gamma" }
        ]
      }]
    };

    applySelectionHighlights(tree, [link()]);

    const paragraph = tree.children[0];
    const strong = paragraph.children[1] as {
      children: Array<{ tagName?: string; properties?: Record<string, unknown> }>;
    };
    expect(strong.children[0]).toMatchObject({
      type: "element",
      tagName: "mark",
      properties: {
        className: ["selection-card-mark"],
        "data-selection-link-id": "link-1"
      }
    });
  });

  it("does not mark stale offsets whose snapshot no longer matches", () => {
    const tree = {
      type: "root",
      children: [{ type: "text", value: "Alpha changed" }]
    };

    applySelectionHighlights(tree, [link()]);

    expect(tree.children).toEqual([{ type: "text", value: "Alpha changed" }]);
  });

  it("splits plain text and marks every part of a link spanning child elements", () => {
    const tree = {
      type: "root",
      children: [{
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          { type: "text", value: "Alpha " },
          {
            type: "element",
            tagName: "strong",
            properties: {},
            children: [{ type: "text", value: "beta" }]
          },
          { type: "text", value: " gamma" }
        ]
      }]
    };
    applySelectionHighlights(tree, [link({
      selectedText: "Alpha beta",
      startOffset: 0,
      endOffset: 10
    })]);

    const paragraph = tree.children[0] as {
      children: Array<{
        tagName?: string;
        children?: Array<{ tagName?: string }>;
      }>;
    };
    expect(paragraph.children[0].tagName).toBe("mark");
    expect(paragraph.children[1].children?.[0].tagName).toBe("mark");
    expect(paragraph.children[2].tagName).toBeUndefined();
  });

  it("keeps unlinked prefix and suffix text around a marked range", () => {
    const tree = {
      type: "root",
      children: [{ type: "text", value: "Alpha beta gamma" }]
    };

    applySelectionHighlights(tree, [link()]);

    expect(tree.children).toMatchObject([
      { type: "text", value: "Alpha " },
      { type: "element", tagName: "mark" },
      { type: "text", value: " gamma" }
    ]);
  });
});

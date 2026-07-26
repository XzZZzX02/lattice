import { describe, expect, it } from "vitest";
import { resolveSourceSelection, selectionFromContainer } from "./selection";

describe("resolveSourceSelection", () => {
  it("maps a repeated rendered selection to the matching source occurrence", () => {
    expect(resolveSourceSelection(
      "**term** then term",
      "term then ",
      "term"
    )).toEqual({
      text: "term",
      startOffset: 14,
      endOffset: 18
    });
  });

  it("returns null for empty or unmappable selections", () => {
    expect(resolveSourceSelection("answer", "", "  ")).toBeNull();
    expect(resolveSourceSelection("answer", "", "missing")).toBeNull();
  });

  it("reads the active DOM range and maps the second occurrence", () => {
    const container = document.createElement("div");
    container.textContent = "term then term";
    document.body.append(container);
    const range = document.createRange();
    range.setStart(container.firstChild!, 10);
    range.setEnd(container.firstChild!, 14);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selectionFromContainer(container, "**term** then term", selection)).toEqual({
      text: "term",
      startOffset: 10,
      endOffset: 14,
      renderedStartOffset: 10,
      renderedEndOffset: 14
    });
    expect(selectionFromContainer(container, "answer", null)).toBeNull();
    container.remove();
  });

  it("keeps a selection that crosses Markdown formatting boundaries", () => {
    const container = document.createElement("div");
    const prefix = document.createTextNode("Alpha ");
    const strong = document.createElement("strong");
    strong.textContent = "beta";
    container.append(prefix, strong);
    document.body.append(container);
    const range = document.createRange();
    range.setStart(prefix, 0);
    range.setEnd(strong.firstChild!, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selectionFromContainer(container, "Alpha **beta**", selection)).toEqual({
      text: "Alpha beta",
      startOffset: 0,
      endOffset: 10,
      renderedStartOffset: 0,
      renderedEndOffset: 10
    });
    container.remove();
  });
});

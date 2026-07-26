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
      startOffset: 14,
      endOffset: 18
    });
    expect(selectionFromContainer(container, "answer", null)).toBeNull();
    container.remove();
  });
});

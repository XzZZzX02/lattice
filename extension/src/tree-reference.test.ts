import { afterEach, describe, expect, it, vi } from "vitest";
import { linkTreeReferences, resolveTreeReference } from "./tree-reference";
import type { TreeCard } from "./tree-types";

const card: TreeCard = { id: "one", rootKey: "chatgpt:main", sourceKey: "chatgpt:main", sourceUrl: "https://chatgpt.com/c/main", sourceMessageId: "message:a", label: "KV Cache", collapsed: true, draft: "", createdAt: "today", anchor: { id: "anchor", messageId: "message:a", text: "KV Cache", startOffset: 12, endOffset: 20, note: "", createdAt: "today" } };
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("non-destructive conversation references", () => {
  it("marks the exact repeated occurrence without replacing native nodes", () => {
    const container = document.createElement("div");
    container.innerHTML = '<p>KV Cache / <strong> KV Cache</strong></p><a href="https://example.org">native citation</a>';
    const html = container.innerHTML;
    const link = container.querySelector("a");
    const text = container.textContent!;
    const startOffset = text.lastIndexOf("KV Cache");
    const reference = resolveTreeReference({ ...card, anchor: { ...card.anchor!, startOffset, endOffset: startOffset + 8 } }, container)!;
    expect(reference.range.startContainer).toBe(container.querySelector("strong")!.firstChild);
    expect(reference.range.toString()).toBe("KV Cache");
    expect(container.innerHTML).toBe(html);
    expect(container.querySelector("a")).toBe(link);
  });
  it("refuses an ambiguous quote after the answer changes", () => {
    const container = document.createElement("div");
    container.textContent = "edited KV Cache / KV Cache";
    expect(resolveTreeReference({ ...card, anchor: { ...card.anchor!, startOffset: 0, endOffset: 8 } }, container)).toBeNull();
  });
  it("leaves native citation clicks alone and removes quote handlers on cleanup", () => {
    document.body.innerHTML = '<div id="answer">KV Cache<a href="https://example.org">citation</a></div>';
    const container = document.getElementById("answer")!;
    const reference = resolveTreeReference({ ...card, anchor: { ...card.anchor!, startOffset: 0, endOffset: 8 } }, container)!;
    reference.range.getClientRects = () => [{ left: 10, right: 90, top: 20, bottom: 40 }] as unknown as DOMRectList;
    const opened = vi.fn();
    const stop = linkTreeReferences([reference], undefined, opened);
    const click = (node: Element) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
    // Stop actual navigation while still exercising the native interactive node.
    container.querySelector("a")!.addEventListener("click", (event) => event.preventDefault());
    click(container.querySelector("a")!);
    expect(opened).not.toHaveBeenCalled();
    click(container);
    expect(opened).toHaveBeenCalledExactlyOnceWith(reference.card);
    stop();
    click(container);
    expect(opened).toHaveBeenCalledOnce();
  });
});

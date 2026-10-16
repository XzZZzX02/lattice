import { describe, expect, it } from "vitest";
import { sanitizeTree } from "./tree-storage";
import type { TreeCard } from "./tree-types";
const card: TreeCard = { id: "one", rootKey: "chatgpt:main", sourceKey: "chatgpt:main", sourceUrl: "https://chatgpt.com/c/main", sourceMessageId: "message:a", label: "KV Cache", collapsed: true, draft: "Follow up", createdAt: "today", targetKey: "chatgpt:child", targetUrl: "https://chatgpt.com/c/child", inheritedTurns: 1 };
describe("tree backup validation", () => {
  it("restores native context URLs, drafts and collapsed state", () => {
    expect(sanitizeTree([card], card.rootKey)).toEqual([card]);
  });
  it("rejects unsafe URLs, orphan branches, cycles and foreign roots", () => {
    const child = { ...card, id: "two", parentId: "missing", sourceKey: "chatgpt:child", sourceUrl: card.targetUrl };
    expect(sanitizeTree([{ ...card, targetUrl: "javascript:alert(1)" }, child, { ...card, id: "foreign", rootKey: "chatgpt:other" }], card.rootKey)).toEqual([]);
    expect(sanitizeTree([{ ...card, parentId: "one", sourceKey: "chatgpt:child", sourceUrl: card.targetUrl }], card.rootKey)).toEqual([]);
  });
});

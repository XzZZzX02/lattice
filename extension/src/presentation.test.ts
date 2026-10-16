import { describe, expect, it } from "vitest";
import { BRANCH_TTL, confirmBranch, connectedBranches, conversationKey, emptyPresentation, mutatePresentation } from "./presentation";
import { backupMarkdown, createBackup, parseBackup } from "./backup";
import type { BranchLink, ChatSnapshot, PendingBranch } from "./types";
import type { TreeCard } from "./tree-types";

const now = Date.now();
const pending: PendingBranch = { token: "t", sourceTabId: 1, sourceKey: "chatgpt:source", sourceUrl: "https://chatgpt.com/c/source", sourceMessageId: "message:a", sourceTitle: "Source question", createdAt: now };
const link = confirmBranch(pending, "https://chatgpt.com/c/child", "Child", now)!;
const snapshot: ChatSnapshot = { route: pending.sourceUrl, conversationKey: pending.sourceKey, url: pending.sourceUrl, title: "Source", answers: [] };

describe("presentation metadata", () => {
  it("accepts saved native conversations and rejects unrelated origins", () => {
    expect(conversationKey("https://chatgpt.com/g/project/c/abc-123?x=1")).toBe("chatgpt:abc-123");
    expect(conversationKey("https://chatgpt.com/")).toBeNull();
    expect(conversationKey("https://chatgpt.com.evil.org/c/abc")).toBeNull();
  });
  it("links only a new native conversation within the branch correlation window", () => {
    expect(confirmBranch(pending, pending.sourceUrl, "Same", now)).toBeNull();
    expect(confirmBranch(pending, "https://example.org/c/child", "Other", now)).toBeNull();
    expect(confirmBranch(pending, link.targetUrl, "Late", now + BRANCH_TTL + 1)).toBeNull();
    expect(link.sourceMessageId).toBe("message:a");
  });
  it("limits the branch map to the connected family, including siblings and ancestors", () => {
    const sibling = { ...link, targetKey: "chatgpt:sibling", targetUrl: "https://chatgpt.com/c/sibling" };
    const unrelated = { ...link, sourceKey: "chatgpt:other", targetKey: "chatgpt:unrelated" };
    expect(connectedBranches([link, sibling, unrelated], "chatgpt:child")).toEqual([link, sibling]);
  });
  it("deletes local graph edges with their node without deleting the excerpt or native answer", () => {
    let state = emptyPresentation();
    state = mutatePresentation(state, { type: "excerpt:add", excerpt: { id: "e", messageId: "m", text: "Quote", note: "Note", startOffset: 0, endOffset: 5, createdAt: "today" } });
    for (const id of ["n1", "n2"]) state = mutatePresentation(state, { type: "mind:add", node: { id, excerptId: id, messageId: "m", label: id, x: 0, y: 0 } });
    state = mutatePresentation(state, { type: "mind:connect", edge: { id: "edge", source: "n1", target: "n2", label: "supports" } });
    state = mutatePresentation(state, { type: "mind:remove", id: "n1" });
    expect(state.mindNodes.map((node) => node.id)).toEqual(["n2"]);
    expect(state.mindEdges).toEqual([]);
    expect(state.excerpts).toHaveLength(1);
  });
  it("round trips local organization without including full ChatGPT transcripts", () => {
    const state = mutatePresentation(emptyPresentation(), { type: "title", messageId: "a", title: "My card" });
    const backup = createBackup({ ...snapshot, answers: [{ id: "a", text: "Private complete transcript" } as ChatSnapshot["answers"][number]] }, state, [link]);
    const serialized = JSON.stringify(backup);
    expect(serialized).not.toContain("Private complete transcript");
    expect(parseBackup(serialized, snapshot.conversationKey)).toEqual({ presentation: state, branches: [link] });
    expect(() => parseBackup(serialized, "chatgpt:other")).toThrow("原会话");
    expect(backupMarkdown(backup)).toContain("https://chatgpt.com/c/source");
  });
  it("strips unsafe imported branch URLs and malformed excerpt data", () => {
    const backup = createBackup(snapshot, emptyPresentation(), []);
    backup.branches = [{ ...link, targetUrl: "javascript:alert(1)" }] as BranchLink[];
    backup.presentation.excerpts = [{ id: "bad", text: "fake" }] as typeof backup.presentation.excerpts;
    const restored = parseBackup(JSON.stringify(backup), snapshot.conversationKey);
    expect(restored.branches).toEqual([]);
    expect(restored.presentation.excerpts).toEqual([]);
    backup.branches = [{ ...link, targetKey: null, targetUrl: "javascript:alert(1)" }] as unknown as BranchLink[];
    expect(parseBackup(JSON.stringify(backup), snapshot.conversationKey).branches).toEqual([]);
  });
  it("round trips a nested tree with drafts and real context addresses", () => {
    const parent: TreeCard = { id: "p", rootKey: pending.sourceKey, sourceKey: pending.sourceKey, sourceUrl: pending.sourceUrl, sourceMessageId: "message:a", label: "Term", draft: "Follow up", collapsed: true, createdAt: "today", targetKey: link.targetKey, targetUrl: link.targetUrl, inheritedTurns: 1 };
    const child: TreeCard = { ...parent, id: "c", parentId: parent.id, sourceKey: link.targetKey, sourceUrl: link.targetUrl, sourceMessageId: "message:b", targetKey: "chatgpt:grandchild", targetUrl: "https://chatgpt.com/c/grandchild" };
    const backup = createBackup(snapshot, emptyPresentation(), [link], [parent, child]);
    expect(parseBackup(JSON.stringify(backup), pending.sourceKey).tree).toEqual([parent, child]);
    expect(backupMarkdown(backup)).toContain("https://chatgpt.com/c/grandchild");
  });
});

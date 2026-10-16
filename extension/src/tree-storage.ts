import { conversationKey, readPresentation } from "./presentation";
import type { TreeCard } from "./tree-types";

export function sanitizeTree(value: unknown, rootKey: string): TreeCard[] {
  if (!Array.isArray(value)) return [];
  const candidates: TreeCard[] = [];
  for (const item of value.slice(0, 250)) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || candidates.some((card) => card.id === item.id) || item.rootKey !== rootKey || typeof item.sourceUrl !== "string" || conversationKey(item.sourceUrl) !== item.sourceKey || typeof item.sourceMessageId !== "string" || !/^(message|turn):/.test(item.sourceMessageId) || typeof item.label !== "string" || typeof item.createdAt !== "string") continue;
    if ((item.targetKey || item.targetUrl) && (typeof item.targetUrl !== "string" || conversationKey(item.targetUrl) !== item.targetKey || item.targetKey === item.sourceKey)) continue;
    const anchor = readPresentation({ version: 1, excerpts: item.anchor ? [item.anchor] : [] }).excerpts[0];
    const source = new URL(item.sourceUrl);
    candidates.push({ id: item.id, rootKey, sourceKey: item.sourceKey, sourceUrl: source.origin + source.pathname, sourceMessageId: item.sourceMessageId, label: item.label.slice(0, 120), createdAt: item.createdAt, collapsed: !!item.collapsed, draft: typeof item.draft === "string" ? item.draft.slice(0, 20000) : "", ...(typeof item.parentId === "string" ? { parentId: item.parentId } : {}), ...(item.targetKey ? { targetKey: item.targetKey, targetUrl: new URL(item.targetUrl).origin + new URL(item.targetUrl).pathname } : {}), ...(Number.isInteger(item.inheritedTurns) && item.inheritedTurns >= 0 ? { inheritedTurns: item.inheritedTurns } : {}), ...(anchor ? { anchor } : {}) });
  }
  function valid(card: TreeCard, seen = new Set<string>()): boolean {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    if (!card.parentId) return card.sourceKey === rootKey;
    const parent = candidates.find((item) => item.id === card.parentId);
    return !!parent && parent.targetKey === card.sourceKey && valid(parent, seen);
  }
  return candidates.filter((card) => valid(card));
}

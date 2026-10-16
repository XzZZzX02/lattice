import type { BranchLink, PendingBranch, Presentation, PresentationMutation } from "./types";

export const BRANCHES_KEY = "lattice:branches:v1";
export const BRANCH_TTL = 45_000;
export const presentationKey = (key: string) => `lattice:presentation:${key}`;

export function emptyPresentation(): Presentation {
  return { version: 1, titles: {}, favorites: [], excerpts: [], cardView: true, mindNodes: [], mindEdges: [] };
}

export function readPresentation(value: unknown): Presentation {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return emptyPresentation();
  const record = value as Presentation;
  return {
    version: 1,
    titles: record.titles && typeof record.titles === "object" ? Object.fromEntries(Object.entries(record.titles).filter(([, title]) => typeof title === "string").map(([id, title]) => [id, title.slice(0, 160)])) : {},
    favorites: Array.isArray(record.favorites) ? record.favorites.filter((id) => typeof id === "string") : [],
    excerpts: Array.isArray(record.excerpts) ? record.excerpts.filter((item) => item && typeof item.id === "string" && typeof item.text === "string" && typeof item.messageId === "string" && typeof item.note === "string" && Number.isInteger(item.startOffset) && item.startOffset >= 0 && item.endOffset === item.startOffset + item.text.length && typeof item.createdAt === "string") : [],
    cardView: record.cardView !== false,
    mindNodes: Array.isArray(record.mindNodes) ? record.mindNodes.filter((node) => node && typeof node.id === "string" && typeof node.label === "string" && typeof node.excerptId === "string" && typeof node.messageId === "string" && Number.isFinite(node.x) && Number.isFinite(node.y)) : [],
    mindEdges: Array.isArray(record.mindEdges) ? record.mindEdges.filter((edge) => edge && typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string" && typeof edge.label === "string") : []
  };
}

export function mutatePresentation(state: Presentation, mutation: PresentationMutation): Presentation {
  switch (mutation.type) {
    case "clear": return emptyPresentation();
    case "restore": return readPresentation(mutation.presentation);
    case "cardView": return { ...state, cardView: mutation.enabled };
    case "title": {
      const titles = { ...state.titles };
      if (mutation.title.trim()) titles[mutation.messageId] = mutation.title.trim().slice(0, 160);
      else delete titles[mutation.messageId];
      return { ...state, titles };
    }
    case "favorite": return { ...state, favorites: mutation.favorite ? [...new Set([...state.favorites, mutation.messageId])] : state.favorites.filter((id) => id !== mutation.messageId) };
    case "excerpt:add": return { ...state, excerpts: [...state.excerpts.filter((item) => item.id !== mutation.excerpt.id), mutation.excerpt] };
    case "excerpt:remove": return { ...state, excerpts: state.excerpts.filter((item) => item.id !== mutation.id) };
    case "mind:add": return state.mindNodes.some((node) => node.excerptId === mutation.node.excerptId) ? state : { ...state, mindNodes: [...state.mindNodes, mutation.node] };
    case "mind:update": return { ...state, mindNodes: state.mindNodes.map((node) => node.id === mutation.id ? { ...node, ...(mutation.label?.trim() ? { label: mutation.label.trim().slice(0, 120) } : {}), ...(Number.isFinite(mutation.x) ? { x: mutation.x! } : {}), ...(Number.isFinite(mutation.y) ? { y: mutation.y! } : {}) } : node) };
    case "mind:remove": return { ...state, mindNodes: state.mindNodes.filter((node) => node.id !== mutation.id), mindEdges: state.mindEdges.filter((edge) => edge.source !== mutation.id && edge.target !== mutation.id) };
    case "mind:connect": {
      const { edge } = mutation;
      if (edge.source === edge.target || !state.mindNodes.some((node) => node.id === edge.source) || !state.mindNodes.some((node) => node.id === edge.target)) return state;
      return { ...state, mindEdges: [...state.mindEdges.filter((item) => item.id !== edge.id && (item.source !== edge.source || item.target !== edge.target)), edge] };
    }
    case "mind:disconnect": return { ...state, mindEdges: state.mindEdges.filter((edge) => edge.id !== mutation.id) };
  }
}

export function conversationKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://chatgpt.com") return null;
    const id = parsed.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)(?:\/|$)/)?.[1];
    return id ? `chatgpt:${id}` : null;
  } catch { return null; }
}

export function confirmBranch(pending: PendingBranch, targetUrl: string, title: string, now = Date.now()): BranchLink | null {
  const targetKey = conversationKey(targetUrl);
  if (!targetKey || targetKey === pending.sourceKey || now - pending.createdAt > BRANCH_TTL || now < pending.createdAt) return null;
  return {
    sourceKey: pending.sourceKey,
    sourceUrl: pending.sourceUrl,
    sourceMessageId: pending.sourceMessageId,
    sourceTitle: pending.sourceTitle,
    targetKey,
    targetUrl: new URL(targetUrl).origin + new URL(targetUrl).pathname,
    targetTitle: title.slice(0, 160),
    createdAt: new Date(now).toISOString(),
    ...(pending.excerpt ? { excerpt: pending.excerpt } : {})
  };
}

export function connectedBranches(links: BranchLink[], key: string | null): BranchLink[] {
  if (!key) return [];
  const included = new Set([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) {
      if (!included.has(link.sourceKey) && !included.has(link.targetKey)) continue;
      if (!included.has(link.sourceKey) || !included.has(link.targetKey)) changed = true;
      included.add(link.sourceKey);
      included.add(link.targetKey);
    }
  }
  return links.filter((link) => included.has(link.sourceKey) && included.has(link.targetKey));
}

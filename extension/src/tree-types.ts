import type { Excerpt } from "./types";

export const TREE_KEY = "lattice:conversation-tree:v1";
export const WORKERS_KEY = "lattice:tree-workers:v1";
export interface TreeCard {
  id: string;
  rootKey: string;
  parentId?: string;
  sourceKey: string;
  sourceUrl: string;
  sourceMessageId: string;
  label: string;
  anchor?: Excerpt;
  collapsed: boolean;
  draft: string;
  createdAt: string;
  targetKey?: string;
  targetUrl?: string;
  inheritedTurns?: number;
}
export interface RemoteTurn { id: string; question: string; text: string; markdown: string }
export interface TreeLive {
  phase: "preparing" | "forking" | "loading" | "sending" | "waiting" | "ready" | "error";
  turns: RemoteTurn[];
  error?: string;
  pending?: string;
  updatedAt: number;
}
export interface NativeCommand { id: string; type: "fork" | "send"; key: string; route?: string; messageId?: string; text?: string }
export interface NativeReport { url: string; key: string | null; title: string; answers: RemoteTurn[]; generating: boolean; composerReady: boolean }
export type TreeMessage =
  | { type: "tree:read"; rootKey: string; pageUrl: string }
  | { type: "tree:create"; rootKey: string; pageUrl: string; parentId?: string; sourceKey: string; sourceUrl: string; messageId: string; label: string; anchor?: Excerpt }
  | { type: "tree:update"; rootKey: string; pageUrl: string; id: string; collapsed?: boolean; draft?: string; label?: string }
  | { type: "tree:send"; rootKey: string; pageUrl: string; id: string; text: string }
  | { type: "tree:resume"; rootKey: string; pageUrl: string; id: string }
  | { type: "tree:open"; rootKey: string; pageUrl: string; id: string }
  | { type: "native:hello" }
  | { type: "native:report"; report: NativeReport }
  | { type: "native:ack"; commandId: string; error?: string };
export interface TreeResult {
  cards?: TreeCard[];
  live?: Record<string, TreeLive>;
  cardId?: string;
  managed?: boolean;
  command?: NativeCommand;
}

export interface NativeAnswer {
  id: string;
  stableId: boolean;
  question: string;
  text: string;
  element: HTMLElement;
  contentElement: HTMLElement;
  nativeInteractive?: boolean;
}

export interface ChatSnapshot {
  route: string;
  conversationKey: string | null;
  url: string;
  title: string;
  answers: NativeAnswer[];
  nativeOverlay?: boolean;
}

export interface Excerpt {
  id: string;
  messageId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  note: string;
  createdAt: string;
}

export interface Presentation {
  version: 1;
  titles: Record<string, string>;
  favorites: string[];
  excerpts: Excerpt[];
  cardView: boolean;
  mindNodes: MindNode[];
  mindEdges: MindEdge[];
}

export interface MindNode {
  id: string;
  label: string;
  excerptId: string;
  messageId: string;
  x: number;
  y: number;
}

export interface MindEdge { id: string; source: string; target: string; label: string }

export interface BranchLink {
  sourceKey: string;
  sourceUrl: string;
  sourceMessageId: string;
  sourceTitle: string;
  targetKey: string;
  targetUrl: string;
  targetTitle: string;
  createdAt: string;
  excerpt?: Excerpt;
  manual?: boolean;
}

export type PresentationMutation =
  | { type: "title"; messageId: string; title: string }
  | { type: "favorite"; messageId: string; favorite: boolean }
  | { type: "excerpt:add"; excerpt: Excerpt }
  | { type: "excerpt:remove"; id: string }
  | { type: "cardView"; enabled: boolean }
  | { type: "mind:add"; node: MindNode }
  | { type: "mind:update"; id: string; label?: string; x?: number; y?: number }
  | { type: "mind:remove"; id: string }
  | { type: "mind:connect"; edge: MindEdge }
  | { type: "mind:disconnect"; id: string }
  | { type: "restore"; presentation: Presentation; branches?: BranchLink[]; tree?: import("./tree-types").TreeCard[] }
  | { type: "clear" };

export type ExtensionMessage = import("./tree-types").TreeMessage
  | { type: "presentation:mutate"; key: string; mutation: PresentationMutation; pageUrl?: string }
  | { type: "conversation:ready"; key: string; url: string; title: string }
  | { type: "branch:arm"; key: string; url: string; messageId: string; title: string; excerpt?: Excerpt }
  | { type: "branch:cancel"; token: string }
  | { type: "branch:link"; sourceKey: string; sourceUrl: string; sourceMessageId: string; sourceTitle: string; targetUrl: string; targetTitle: string };

export type ExtensionResponse =
  | ({ ok: true; presentation?: Presentation; token?: string } & import("./tree-types").TreeResult)
  | { ok: false; error: string };

export interface PendingBranch {
  token: string;
  sourceTabId: number;
  sourceKey: string;
  sourceUrl: string;
  sourceMessageId: string;
  sourceTitle: string;
  createdAt: number;
  excerpt?: Excerpt;
}

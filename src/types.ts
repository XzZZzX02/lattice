export type CardRelation = "root" | "child" | "divergent" | "branch";
export type TurnStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

export interface Project {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  systemPrompt: string;
  defaultModelProfileId: string | null;
  rootCardId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  projectId: string;
  parentId: string | null;
  relation: CardRelation;
  branchFromTurnId: string | null;
  title: string;
  summary: string;
  contextSnapshotHash: string;
  contextStale: boolean;
  unread: boolean;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
}

export interface Turn {
  id: string;
  cardId: string;
  userContent: string;
  assistantContent: string;
  modelProfileId: string | null;
  status: TurnStatus;
  errorMessage: string | null;
  requestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspace {
  project: Project;
  cards: Card[];
  turns: Turn[];
  selectionCardLinks: SelectionCardLink[];
}

export type ModelProvider = "ollama" | "openai_compatible";

export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  keychainRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveModelProfileInput {
  id?: string;
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface SendMessageInput {
  cardId: string;
  modelProfileId: string;
  content: string;
  quoteIds: string[];
}

export interface SendMessageOptions {
  quoteIds: string[];
}

export type StreamEvent =
  | { type: "started"; requestId: string; turn: Turn }
  | { type: "delta"; requestId: string; turnId: string; delta: string }
  | { type: "completed"; requestId: string; turn: Turn }
  | { type: "cancelled"; requestId: string; turn: Turn }
  | { type: "failed"; requestId: string; turn: Turn; message: string };

export interface CreateCardInput {
  projectId: string;
  sourceCardId: string;
  relation: Exclude<CardRelation, "root">;
  title: string;
  branchFromTurnId?: string;
  selectedText?: string;
}

export interface CreateSelectionCardInput {
  projectId: string;
  sourceCardId: string;
  sourceTurnId: string;
  title: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
}

export interface SelectionCardLink {
  id: string;
  sourceTurnId: string;
  targetCardId: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
}

export interface SelectionCardCreation {
  card: Card;
  link: SelectionCardLink;
}

export interface Quote {
  id: string;
  turnId: string;
  targetTurnId: string | null;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
}

export interface CreateQuoteInput {
  turnId: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
}

export interface RegeneratedTurn {
  card: Card;
  sourceTurn: Turn;
}

export interface SearchResult {
  entityType: "project" | "card" | "turn";
  entityId: string;
  projectId: string;
  cardId: string | null;
  title: string;
  excerpt: string;
}

export interface LocalDocument {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  localPath: string;
  contentHash: string;
  status: string;
  createdAt: string;
}

export interface DocumentImportResult {
  document: LocalDocument;
  duplicate: boolean;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  pageNumber: number | null;
  headingPath: string;
  startOffset: number;
  endOffset: number;
}

export interface DocumentCitation {
  id: string;
  turnId: string;
  chunkId: string | null;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  headingPath: string;
  excerpt: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  available: boolean;
}

export interface MindNode {
  id: string;
  projectId: string;
  label: string;
  description: string;
  sourceCardId: string | null;
  sourceTurnId: string | null;
  positionX: number;
  positionY: number;
  createdAt: string;
}

export interface MindEdge {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  relation: string;
  createdAt: string;
}

export interface MindNodeSource {
  id: string;
  mindNodeId: string;
  cardId: string | null;
  turnId: string | null;
  createdAt: string;
}

export interface MindscapeGraph {
  nodes: MindNode[];
  edges: MindEdge[];
  sources: MindNodeSource[];
}

export interface CreateMindNodeInput {
  projectId: string;
  label: string;
  description: string;
  sourceCardId?: string;
  sourceTurnId?: string;
}

export interface CreateMindEdgeInput {
  projectId: string;
  sourceId: string;
  targetId: string;
  relation: string;
}

export interface ConceptSuggestion {
  id: string;
  label: string;
  description: string;
}

export interface RelationSuggestion {
  id: string;
  sourceKey: string;
  targetKey: string;
  relation: string;
}

export interface MergeSuggestion {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  reason: string;
}

export interface MindSuggestionSet {
  projectId: string;
  sourceCardId: string;
  concepts: ConceptSuggestion[];
  relations: RelationSuggestion[];
  merges: MergeSuggestion[];
}

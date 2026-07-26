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
}

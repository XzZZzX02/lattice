import { create } from "zustand";
import {
  cardApi, chatApi, documentApi, fileApi, knowledgeApi, mindscapeApi, modelApi,
  quoteApi, turnApi, workspaceApi
} from "../lib/ipc";
import type { ExportFormat } from "../lib/ipc";
import type {
  CreateCardInput, CreateMindEdgeInput, CreateMindNodeInput, CreateQuoteInput,
  CreateSelectionCardInput,
  DocumentCitation, LocalDocument, MindscapeGraph, ModelProfile, Project,
  MindSuggestionSet, ProjectWorkspace, Quote, SearchResult, StreamEvent, Turn
} from "../types";

interface WorkspaceState {
  projects: Project[];
  workspace: ProjectWorkspace | null;
  loading: boolean;
  error: string | null;
  modelProfiles: ModelProfile[];
  activeModelProfileId: string | null;
  activeRequestId: string | null;
  activeCardId: string | null;
  pendingQuotes: Quote[];
  favoriteTurnIds: string[];
  searchResults: SearchResult[];
  documents: LocalDocument[];
  documentCitations: DocumentCitation[];
  mindscape: MindscapeGraph;
  mindSuggestions: MindSuggestionSet | null;
  suggestingMindscape: boolean;
  loadProjects: () => Promise<void>;
  createProject: (title: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  loadModels: () => Promise<void>;
  setActiveModel: (profileId: string) => void;
  sendMessage: (cardId: string, content: string) => Promise<void>;
  cancelMessage: () => Promise<void>;
  selectCard: (cardId: string) => void;
  createCard: (input: CreateCardInput) => Promise<void>;
  createCardFromSelection: (input: CreateSelectionCardInput) => Promise<void>;
  renameCard: (cardId: string, title: string) => Promise<void>;
  addQuote: (input: CreateQuoteInput) => Promise<void>;
  removeQuote: (quoteId: string) => void;
  editTurn: (turnId: string, userContent: string) => Promise<void>;
  deleteTurn: (turnId: string) => Promise<void>;
  regenerateTurn: (turnId: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  toggleFavorite: (turnId: string, cardId: string) => Promise<void>;
  exportProject: (format: ExportFormat) => Promise<boolean>;
  importProject: () => Promise<boolean>;
  importDocument: () => Promise<boolean>;
  deleteDocument: (documentId: string) => Promise<void>;
  addMindNode: (input: CreateMindNodeInput) => Promise<void>;
  addMindEdge: (input: CreateMindEdgeInput) => Promise<void>;
  updateMindNode: (
    nodeId: string,
    label: string,
    description: string,
    positionX: number,
    positionY: number
  ) => Promise<void>;
  suggestMindscape: (sourceCardId: string) => Promise<void>;
  applyMindSuggestions: (acceptedIds: string[]) => Promise<void>;
  dismissMindSuggestions: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  workspace: null,
  loading: false,
  error: null,
  modelProfiles: [],
  activeModelProfileId: null,
  activeRequestId: null,
  activeCardId: null,
  pendingQuotes: [],
  favoriteTurnIds: [],
  searchResults: [],
  documents: [],
  documentCitations: [],
  mindscape: { nodes: [], edges: [], sources: [] },
  mindSuggestions: null,
  suggestingMindscape: false,
  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await workspaceApi.listProjects();
      set({ projects, loading: false });
      if (!get().workspace && projects[0]) {
        await get().selectProject(projects[0].id);
      }
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },
  createProject: async (title) => {
    set({ loading: true, error: null });
    try {
      const workspace = await workspaceApi.createProject(title);
      set((state) => ({
        workspace,
        activeCardId: workspace.project.rootCardId,
        documents: [],
        documentCitations: [],
        mindscape: { nodes: [], edges: [], sources: [] },
        mindSuggestions: null,
        projects: [workspace.project, ...state.projects],
        loading: false
      }));
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },
  selectProject: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const workspace = await workspaceApi.getWorkspace(projectId);
      const favoriteTurnIds = await knowledgeApi.favoriteTurnIds(projectId);
      const documents = await documentApi.list(projectId);
      const documentCitations = await documentApi.citations(projectId);
      const mindscape = await mindscapeApi.get(projectId);
      set({
        workspace,
        favoriteTurnIds,
        documents,
        documentCitations,
        mindscape,
        mindSuggestions: null,
        activeCardId: workspace.project.rootCardId,
        loading: false
      });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },
  loadModels: async () => {
    try {
      const modelProfiles = await modelApi.list();
      set((state) => ({
        modelProfiles,
        activeModelProfileId:
          state.activeModelProfileId ?? modelProfiles[0]?.id ?? null
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  setActiveModel: (activeModelProfileId) => set({ activeModelProfileId }),
  sendMessage: async (cardId, content) => {
    const modelProfileId = get().activeModelProfileId;
    if (!modelProfileId) {
      set({ error: "Configure and select a model first" });
      return;
    }
    set({ error: null });
    const handleEvent = (event: StreamEvent) => {
      set((state) => ({
        activeRequestId:
          event.type === "started" || event.type === "delta"
            ? event.requestId
            : null,
        workspace: state.workspace
          ? {
              ...state.workspace,
              turns: reduceTurns(state.workspace.turns, event)
            }
          : null,
        error: event.type === "failed" ? event.message : state.error
      }));
    };
    try {
      await chatApi.send(
        {
          cardId,
          modelProfileId,
          content,
          quoteIds: get().pendingQuotes.map((quote) => quote.id)
        },
        handleEvent
      );
      const projectId = get().workspace?.project.id;
      if (projectId) {
        const documentCitations = await documentApi.citations(projectId);
        set({ documentCitations });
      }
      set({ pendingQuotes: [] });
    } catch (error) {
      set({ activeRequestId: null, error: errorMessage(error) });
    }
  },
  cancelMessage: async () => {
    const requestId = get().activeRequestId;
    if (!requestId) return;
    try {
      await chatApi.cancel(requestId);
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  selectCard: (activeCardId) => set({ activeCardId }),
  createCard: async (input) => {
    try {
      const card = await cardApi.create(input);
      set((state) => ({
        activeCardId: card.id,
        workspace: state.workspace
          ? { ...state.workspace, cards: [...state.workspace.cards, card] }
          : null
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  createCardFromSelection: async (input) => {
    if (get().workspace?.project.id !== input.projectId) return;
    try {
      const created = await cardApi.createFromSelection(input);
      set((state) => {
        if (state.workspace?.project.id !== input.projectId) return {};
        return {
          activeCardId: created.card.id,
          workspace: {
            ...state.workspace,
            cards: [...state.workspace.cards, created.card],
            selectionCardLinks: [
              ...state.workspace.selectionCardLinks,
              created.link
            ]
          }
        };
      });
    } catch (error) {
      if (get().workspace?.project.id === input.projectId) {
        set({ error: errorMessage(error) });
      }
    }
  },
  renameCard: async (cardId, title) => {
    try {
      const workspace = await cardApi.rename(cardId, title);
      set({ workspace });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  addQuote: async (input) => {
    try {
      const quote = await quoteApi.create(input);
      set((state) => ({ pendingQuotes: [...state.pendingQuotes, quote] }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  removeQuote: (quoteId) =>
    set((state) => ({
      pendingQuotes: state.pendingQuotes.filter((quote) => quote.id !== quoteId)
    })),
  editTurn: async (turnId, userContent) => {
    try {
      const workspace = await turnApi.edit(turnId, userContent);
      set({ workspace });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  deleteTurn: async (turnId) => {
    try {
      const workspace = await turnApi.delete(turnId);
      set({ workspace });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  regenerateTurn: async (turnId) => {
    try {
      const regenerated = await turnApi.regenerate(turnId);
      set((state) => ({
        activeCardId: regenerated.card.id,
        workspace: state.workspace
          ? {
              ...state.workspace,
              cards: [...state.workspace.cards, regenerated.card]
            }
          : null
      }));
      await get().sendMessage(regenerated.card.id, regenerated.sourceTurn.userContent);
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  search: async (query) => {
    try {
      const searchResults = await knowledgeApi.search(
        query,
        get().workspace?.project.id
      );
      set({ searchResults });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  toggleFavorite: async (turnId, cardId) => {
    const projectId = get().workspace?.project.id;
    if (!projectId) return;
    try {
      const favorited = await knowledgeApi.toggleFavorite(projectId, cardId, turnId);
      set((state) => ({
        favoriteTurnIds: favorited
          ? [...state.favoriteTurnIds, turnId]
          : state.favoriteTurnIds.filter((id) => id !== turnId)
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  exportProject: async (format) => {
    const project = get().workspace?.project;
    if (!project) return false;
    try {
      set({ error: null });
      return await fileApi.exportProject(project.id, project.title, format);
    } catch (error) {
      set({ error: errorMessage(error) });
      return false;
    }
  },
  importProject: async () => {
    try {
      set({ loading: true, error: null });
      const workspace = await fileApi.importProject();
      if (!workspace) {
        set({ loading: false });
        return false;
      }
      const favoriteTurnIds = await knowledgeApi.favoriteTurnIds(
        workspace.project.id
      );
      const documents = await documentApi.list(workspace.project.id);
      const documentCitations = await documentApi.citations(workspace.project.id);
      const mindscape = await mindscapeApi.get(workspace.project.id);
      set((state) => ({
        workspace,
        favoriteTurnIds,
        documents,
        documentCitations,
        mindscape,
        mindSuggestions: null,
        activeCardId: workspace.project.rootCardId,
        projects: [
          workspace.project,
          ...state.projects.filter((project) => project.id !== workspace.project.id)
        ],
        loading: false
      }));
      return true;
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      return false;
    }
  },
  importDocument: async () => {
    const projectId = get().workspace?.project.id;
    if (!projectId) return false;
    try {
      const result = await documentApi.import(projectId);
      if (!result) return false;
      set((state) => ({
        documents: state.documents.some(
          (document) => document.id === result.document.id
        )
          ? state.documents
          : [...state.documents, result.document]
      }));
      return true;
    } catch (error) {
      set({ error: errorMessage(error) });
      return false;
    }
  },
  deleteDocument: async (documentId) => {
    const projectId = get().workspace?.project.id;
    if (!projectId) return;
    try {
      await documentApi.delete(projectId, documentId);
      const documentCitations = await documentApi.citations(projectId);
      set((state) => ({
        documents: state.documents.filter(
          (document) => document.id !== documentId
        ),
        documentCitations
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  addMindNode: async (input) => {
    try {
      await mindscapeApi.createNode(input);
      const mindscape = await mindscapeApi.get(input.projectId);
      set({ mindscape });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  addMindEdge: async (input) => {
    try {
      await mindscapeApi.createEdge(input);
      const mindscape = await mindscapeApi.get(input.projectId);
      set({ mindscape });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  updateMindNode: async (
    nodeId,
    label,
    description,
    positionX,
    positionY
  ) => {
    const projectId = get().workspace?.project.id;
    if (!projectId) return;
    try {
      const node = await mindscapeApi.updateNode(
        projectId,
        nodeId,
        label,
        description,
        positionX,
        positionY
      );
      set((state) => ({
        mindscape: {
          ...state.mindscape,
          nodes: state.mindscape.nodes.map((current) =>
            current.id === node.id ? node : current
          )
        }
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  suggestMindscape: async (sourceCardId) => {
    const state = get();
    const projectId = state.workspace?.project.id;
    const modelProfileId = state.activeModelProfileId;
    if (!projectId || !modelProfileId) {
      set({ error: "Configure and select a model before requesting suggestions" });
      return;
    }
    set({ suggestingMindscape: true, error: null });
    try {
      const mindSuggestions = await mindscapeApi.suggest(
        projectId,
        sourceCardId,
        modelProfileId
      );
      set({ mindSuggestions, suggestingMindscape: false });
    } catch (error) {
      set({
        suggestingMindscape: false,
        error: errorMessage(error)
      });
    }
  },
  applyMindSuggestions: async (acceptedIds) => {
    const suggestions = get().mindSuggestions;
    if (!suggestions) return;
    if (acceptedIds.length === 0) {
      set({ mindSuggestions: null });
      return;
    }
    try {
      const mindscape = await mindscapeApi.applySuggestions(
        suggestions,
        acceptedIds
      );
      set({ mindscape, mindSuggestions: null });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  dismissMindSuggestions: () => set({ mindSuggestions: null })
}));

export function reduceTurns(turns: Turn[], event: StreamEvent): Turn[] {
  if (event.type === "started") return [...turns, event.turn];
  if (event.type === "delta") {
    return turns.map((turn) =>
      turn.id === event.turnId
        ? { ...turn, assistantContent: turn.assistantContent + event.delta }
        : turn
    );
  }
  return turns.map((turn) => (turn.id === event.turn.id ? event.turn : turn));
}

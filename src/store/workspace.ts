import { create } from "zustand";
import { chatApi, modelApi, workspaceApi } from "../lib/ipc";
import type { ModelProfile, Project, ProjectWorkspace, StreamEvent, Turn } from "../types";

interface WorkspaceState {
  projects: Project[];
  workspace: ProjectWorkspace | null;
  loading: boolean;
  error: string | null;
  modelProfiles: ModelProfile[];
  activeModelProfileId: string | null;
  activeRequestId: string | null;
  loadProjects: () => Promise<void>;
  createProject: (title: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  loadModels: () => Promise<void>;
  setActiveModel: (profileId: string) => void;
  sendMessage: (cardId: string, content: string) => Promise<void>;
  cancelMessage: () => Promise<void>;
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
      set({ workspace, loading: false });
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
      await chatApi.send({ cardId, modelProfileId, content }, handleEvent);
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
  }
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

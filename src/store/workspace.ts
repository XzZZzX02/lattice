import { create } from "zustand";
import { workspaceApi } from "../lib/ipc";
import type { Project, ProjectWorkspace } from "../types";

interface WorkspaceState {
  projects: Project[];
  workspace: ProjectWorkspace | null;
  loading: boolean;
  error: string | null;
  loadProjects: () => Promise<void>;
  createProject: (title: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  workspace: null,
  loading: false,
  error: null,
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
  }
}));

import { invoke } from "@tauri-apps/api/core";
import type { Project, ProjectWorkspace } from "../types";

export const workspaceApi = {
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (title: string) =>
    invoke<ProjectWorkspace>("create_project", { title }),
  getWorkspace: (projectId: string) =>
    invoke<ProjectWorkspace>("get_workspace", { projectId }),
  renameProject: (projectId: string, title: string) =>
    invoke<void>("rename_project", { projectId, title }),
  archiveProject: (projectId: string) =>
    invoke<void>("archive_project", { projectId })
};

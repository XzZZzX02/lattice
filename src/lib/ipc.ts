import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  Card,
  CreateCardInput,
  CreateQuoteInput,
  ModelProfile,
  Project,
  ProjectWorkspace,
  Quote,
  RegeneratedTurn,
  SaveModelProfileInput,
  SearchResult,
  SendMessageInput,
  StreamEvent,
  Turn
} from "../types";

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

export const modelApi = {
  list: () => invoke<ModelProfile[]>("list_model_profiles"),
  save: (input: SaveModelProfileInput) =>
    invoke<ModelProfile>("save_model_profile", { input }),
  test: (profileId: string) =>
    invoke<string[]>("test_model_profile", { profileId })
};

export const chatApi = {
  send: (input: SendMessageInput, onEvent: (event: StreamEvent) => void) => {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = onEvent;
    return invoke<Turn>("send_message", { input, onEvent: channel });
  },
  cancel: (requestId: string) =>
    invoke<void>("cancel_message", { requestId })
};

export const cardApi = {
  create: (input: CreateCardInput) =>
    invoke<Card>("create_card", { input }),
  rename: (cardId: string, title: string) =>
    invoke<ProjectWorkspace>("rename_card", { cardId, title })
};

export const quoteApi = {
  create: (input: CreateQuoteInput) =>
    invoke<Quote>("create_quote", { input })
};

export const turnApi = {
  edit: (turnId: string, userContent: string) =>
    invoke<ProjectWorkspace>("edit_turn", { turnId, userContent }),
  delete: (turnId: string) =>
    invoke<ProjectWorkspace>("delete_turn", { turnId }),
  regenerate: (turnId: string) =>
    invoke<RegeneratedTurn>("regenerate_turn", { turnId })
};

export const knowledgeApi = {
  search: (query: string, projectId?: string) =>
    invoke<SearchResult[]>("search", { query, projectId }),
  toggleFavorite: (projectId: string, cardId: string, turnId: string) =>
    invoke<boolean>("toggle_turn_favorite", { projectId, cardId, turnId }),
  favoriteTurnIds: (projectId: string) =>
    invoke<string[]>("favorite_turn_ids", { projectId })
};

export type ExportFormat = "json" | "markdown";

export const fileApi = {
  exportProject: async (
    projectId: string,
    projectTitle: string,
    format: ExportFormat
  ) => {
    const extension = format === "markdown" ? "md" : "json";
    const path = await save({
      defaultPath: `${safeFilename(projectTitle)}.${extension}`,
      filters: [{
        name: format === "markdown" ? "Markdown" : "Lattice project",
        extensions: [extension]
      }]
    });
    if (!path) return false;
    await invoke<void>("export_project", { projectId, format, path });
    return true;
  },
  importProject: async () => {
    const path = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Lattice project", extensions: ["json"] }]
    });
    if (typeof path !== "string") return null;
    return invoke<ProjectWorkspace>("import_project", { path });
  }
};

function safeFilename(value: string): string {
  const filename = [...value.trim().replace(/[<>:"/\\|?*]/g, "-")]
    .filter((character) => character.charCodeAt(0) > 31)
    .join("");
  return filename || "lattice-project";
}

import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  Card,
  CreateCardInput,
  ModelProfile,
  Project,
  ProjectWorkspace,
  SaveModelProfileInput
  , SendMessageInput,
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceApi } from "../lib/ipc";
import type { ProjectWorkspace } from "../types";
import { useWorkspaceStore } from "./workspace";

vi.mock("../lib/ipc", () => ({
  workspaceApi: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getWorkspace: vi.fn()
  }
}));

const workspace: ProjectWorkspace = {
  project: {
    id: "project-1",
    folderId: null,
    title: "Research",
    description: "",
    systemPrompt: "",
    defaultModelProfileId: null,
    rootCardId: "card-1",
    archived: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01"
  },
  cards: [{
    id: "card-1",
    projectId: "project-1",
    parentId: null,
    relation: "root",
    branchFromTurnId: null,
    title: "Research",
    summary: "",
    contextSnapshotHash: "",
    contextStale: false,
    unread: false,
    positionX: 0,
    positionY: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01"
  }],
  turns: []
};

describe("workspace store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      projects: [],
      workspace: null,
      loading: false,
      error: null
    });
  });

  it("loads and selects the most recent project", async () => {
    vi.mocked(workspaceApi.listProjects).mockResolvedValue([workspace.project]);
    vi.mocked(workspaceApi.getWorkspace).mockResolvedValue(workspace);

    await useWorkspaceStore.getState().loadProjects();

    expect(useWorkspaceStore.getState().workspace).toEqual(workspace);
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it("creates and prepends a project", async () => {
    vi.mocked(workspaceApi.createProject).mockResolvedValue(workspace);

    await useWorkspaceStore.getState().createProject("Research");

    expect(useWorkspaceStore.getState().projects).toEqual([workspace.project]);
    expect(useWorkspaceStore.getState().workspace).toEqual(workspace);
  });

  it("exposes a safe error from failed operations", async () => {
    vi.mocked(workspaceApi.listProjects).mockRejectedValue("offline");
    await useWorkspaceStore.getState().loadProjects();
    expect(useWorkspaceStore.getState().error).toBe("offline");

    vi.mocked(workspaceApi.getWorkspace).mockRejectedValue(new Error("missing"));
    await useWorkspaceStore.getState().selectProject("missing");
    expect(useWorkspaceStore.getState().error).toBe("missing");

    vi.mocked(workspaceApi.createProject).mockRejectedValue(new Error("failed"));
    await useWorkspaceStore.getState().createProject("Research");
    expect(useWorkspaceStore.getState().error).toBe("failed");
  });
});

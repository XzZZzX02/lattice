import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardApi, chatApi, modelApi, quoteApi, workspaceApi } from "../lib/ipc";
import type { ProjectWorkspace } from "../types";
import { useWorkspaceStore } from "./workspace";

vi.mock("../lib/ipc", () => ({
  workspaceApi: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getWorkspace: vi.fn()
  },
  modelApi: { list: vi.fn() },
  chatApi: { send: vi.fn(), cancel: vi.fn() },
  cardApi: { create: vi.fn(), rename: vi.fn() },
  quoteApi: { create: vi.fn() }
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
      ,modelProfiles: [],
      activeModelProfileId: null,
      activeRequestId: null
      ,activeCardId: null
      ,pendingQuotes: []
    });
  });

  it("loads model profiles and streams immutable turn updates", async () => {
    const profile = {
      id: "m1", name: "Local", provider: "ollama" as const,
      baseUrl: "http://localhost", model: "qwen", keychainRef: null,
      createdAt: "", updatedAt: ""
    };
    vi.mocked(modelApi.list).mockResolvedValue([profile]);
    useWorkspaceStore.setState({ workspace });
    await useWorkspaceStore.getState().loadModels();
    expect(useWorkspaceStore.getState().activeModelProfileId).toBe("m1");

    vi.mocked(chatApi.send).mockImplementation(async (_input, onEvent) => {
      const turn = {
        id: "t1", cardId: "card-1", userContent: "hello",
        assistantContent: "", modelProfileId: "m1", status: "streaming" as const,
        errorMessage: null, requestId: "r1", createdAt: "", updatedAt: ""
      };
      onEvent({ type: "started", requestId: "r1", turn });
      onEvent({ type: "delta", requestId: "r1", turnId: "t1", delta: "world" });
      onEvent({ type: "completed", requestId: "r1", turn: { ...turn, assistantContent: "world", status: "completed" } });
      return { ...turn, assistantContent: "world", status: "completed" };
    });
    await useWorkspaceStore.getState().sendMessage("card-1", "hello");
    expect(useWorkspaceStore.getState().workspace?.turns[0].assistantContent).toBe("world");
    expect(useWorkspaceStore.getState().activeRequestId).toBeNull();
  });

  it("cancels the active request and handles missing configuration", async () => {
    useWorkspaceStore.setState({ activeModelProfileId: null });
    await useWorkspaceStore.getState().sendMessage("card-1", "hello");
    expect(useWorkspaceStore.getState().error).toContain("Configure");

    useWorkspaceStore.setState({ activeRequestId: "r1" });
    vi.mocked(chatApi.cancel).mockResolvedValue();
    await useWorkspaceStore.getState().cancelMessage();
    expect(chatApi.cancel).toHaveBeenCalledWith("r1");
  });

  it("creates, selects, and renames cards", async () => {
    const child = {
      ...workspace.cards[0],
      id: "card-2",
      parentId: "card-1",
      relation: "child" as const,
      title: "Child"
    };
    useWorkspaceStore.setState({ workspace });
    vi.mocked(cardApi.create).mockResolvedValue(child);

    await useWorkspaceStore.getState().createCard({
      projectId: "project-1",
      sourceCardId: "card-1",
      relation: "child",
      title: "Child"
    });
    expect(useWorkspaceStore.getState().activeCardId).toBe("card-2");
    expect(useWorkspaceStore.getState().workspace?.cards).toHaveLength(2);

    useWorkspaceStore.getState().selectCard("card-1");
    expect(useWorkspaceStore.getState().activeCardId).toBe("card-1");

    const renamed = {
      ...workspace,
      cards: [{ ...workspace.cards[0], title: "Renamed" }]
    };
    vi.mocked(cardApi.rename).mockResolvedValue(renamed);
    await useWorkspaceStore.getState().renameCard("card-1", "Renamed");
    expect(useWorkspaceStore.getState().workspace?.cards[0].title).toBe("Renamed");
  });

  it("adds and removes a traceable quote", async () => {
    const quote = {
      id: "q1",
      turnId: "t1",
      targetTurnId: null,
      selectedText: "selected",
      startOffset: 2,
      endOffset: 10,
      createdAt: ""
    };
    vi.mocked(quoteApi.create).mockResolvedValue(quote);

    await useWorkspaceStore.getState().addQuote({
      turnId: "t1",
      selectedText: "selected",
      startOffset: 2,
      endOffset: 10
    });
    expect(useWorkspaceStore.getState().pendingQuotes).toEqual([quote]);

    useWorkspaceStore.getState().removeQuote("q1");
    expect(useWorkspaceStore.getState().pendingQuotes).toEqual([]);
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

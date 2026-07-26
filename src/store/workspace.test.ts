import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardApi, chatApi, documentApi, fileApi, knowledgeApi, mindscapeApi, modelApi,
  quoteApi, turnApi, workspaceApi
} from "../lib/ipc";
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
  cardApi: { create: vi.fn(), createFromSelection: vi.fn(), rename: vi.fn() },
  quoteApi: { create: vi.fn() },
  turnApi: { edit: vi.fn(), delete: vi.fn(), regenerate: vi.fn() },
  fileApi: { exportProject: vi.fn(), importProject: vi.fn() },
  documentApi: {
    list: vi.fn().mockResolvedValue([]),
    citations: vi.fn().mockResolvedValue([]),
    import: vi.fn(),
    delete: vi.fn()
  },
  mindscapeApi: {
    get: vi.fn().mockResolvedValue({ nodes: [], edges: [], sources: [] }),
    createNode: vi.fn(),
    createEdge: vi.fn(),
    updateNode: vi.fn(),
    suggest: vi.fn(),
    applySuggestions: vi.fn()
  },
  knowledgeApi: {
    search: vi.fn(),
    toggleFavorite: vi.fn(),
    favoriteTurnIds: vi.fn().mockResolvedValue([])
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
  turns: [],
  selectionCardLinks: []
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
      ,favoriteTurnIds: [],
      searchResults: []
      ,documents: []
      ,documentCitations: []
      ,mindscape: { nodes: [], edges: [], sources: [] }
      ,mindSuggestions: null,
      suggestingMindscape: false
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

  it("creates one linked child card and enters it immediately", async () => {
    const child = {
      ...workspace.cards[0],
      id: "card-2",
      parentId: "card-1",
      relation: "child" as const,
      title: "selected"
    };
    const link = {
      id: "link-1",
      sourceTurnId: "turn-1",
      targetCardId: "card-2",
      selectedText: "selected",
      startOffset: 4,
      endOffset: 12,
      createdAt: "2026-01-01"
    };
    useWorkspaceStore.setState({ workspace });
    vi.mocked(cardApi.createFromSelection).mockResolvedValue({ card: child, link });

    await useWorkspaceStore.getState().createCardFromSelection({
      projectId: "project-1",
      sourceCardId: "card-1",
      sourceTurnId: "turn-1",
      title: "selected",
      selectedText: "selected",
      startOffset: 4,
      endOffset: 12
    });

    expect(useWorkspaceStore.getState().activeCardId).toBe("card-2");
    expect(useWorkspaceStore.getState().workspace?.cards).toHaveLength(2);
    expect(useWorkspaceStore.getState().workspace?.selectionCardLinks).toEqual([link]);
  });

  it("keeps the workspace unchanged when a selection already has a card", async () => {
    useWorkspaceStore.setState({ workspace, activeCardId: "card-1" });
    vi.mocked(cardApi.createFromSelection).mockRejectedValue(
      new Error("This text already has a card")
    );

    await useWorkspaceStore.getState().createCardFromSelection({
      projectId: "project-1",
      sourceCardId: "card-1",
      sourceTurnId: "turn-1",
      title: "selected",
      selectedText: "selected",
      startOffset: 4,
      endOffset: 12
    });

    expect(useWorkspaceStore.getState().activeCardId).toBe("card-1");
    expect(useWorkspaceStore.getState().workspace).toEqual(workspace);
    expect(useWorkspaceStore.getState().error).toBe("This text already has a card");
  });

  it("ignores selection card creation when no project is open", async () => {
    await useWorkspaceStore.getState().createCardFromSelection({
      projectId: "project-1",
      sourceCardId: "card-1",
      sourceTurnId: "turn-1",
      title: "selected",
      selectedText: "selected",
      startOffset: 4,
      endOffset: 12
    });

    expect(cardApi.createFromSelection).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeCardId).toBeNull();
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

  it("edits, deletes, and regenerates without overwriting the source", async () => {
    const sourceTurn = {
      id: "t1", cardId: "card-1", userContent: "source",
      assistantContent: "answer", modelProfileId: "m1", status: "completed" as const,
      errorMessage: null, requestId: null, createdAt: "", updatedAt: ""
    };
    const withTurn = { ...workspace, turns: [sourceTurn] };
    useWorkspaceStore.setState({
      workspace: withTurn,
      activeModelProfileId: "m1"
    });
    vi.mocked(turnApi.edit).mockResolvedValue({
      ...withTurn,
      turns: [{ ...sourceTurn, userContent: "edited", assistantContent: "", status: "idle" }]
    });
    await useWorkspaceStore.getState().editTurn("t1", "edited");
    expect(useWorkspaceStore.getState().workspace?.turns[0].userContent).toBe("edited");

    vi.mocked(turnApi.delete).mockResolvedValue({ ...workspace, turns: [] });
    await useWorkspaceStore.getState().deleteTurn("t1");
    expect(useWorkspaceStore.getState().workspace?.turns).toEqual([]);

    const branch = {
      ...workspace.cards[0],
      id: "branch",
      parentId: "card-1",
      relation: "branch" as const,
      branchFromTurnId: "t1"
    };
    vi.mocked(turnApi.regenerate).mockResolvedValue({ card: branch, sourceTurn });
    vi.mocked(chatApi.send).mockResolvedValue(sourceTurn);
    await useWorkspaceStore.getState().regenerateTurn("t1");
    expect(useWorkspaceStore.getState().activeCardId).toBe("branch");
    expect(chatApi.send).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: "branch", content: "source" }),
      expect.any(Function)
    );
  });

  it("searches locally and toggles favorites", async () => {
    useWorkspaceStore.setState({ workspace });
    const result = {
      entityType: "turn" as const,
      entityId: "t1",
      projectId: "project-1",
      cardId: "card-1",
      title: "attention_map",
      excerpt: "code"
    };
    vi.mocked(knowledgeApi.search).mockResolvedValue([result]);
    await useWorkspaceStore.getState().search("attention_map");
    expect(useWorkspaceStore.getState().searchResults).toEqual([result]);

    vi.mocked(knowledgeApi.toggleFavorite).mockResolvedValue(true);
    await useWorkspaceStore.getState().toggleFavorite("t1", "card-1");
    expect(useWorkspaceStore.getState().favoriteTurnIds).toEqual(["t1"]);

    vi.mocked(knowledgeApi.toggleFavorite).mockResolvedValue(false);
    await useWorkspaceStore.getState().toggleFavorite("t1", "card-1");
    expect(useWorkspaceStore.getState().favoriteTurnIds).toEqual([]);
  });

  it("loads and selects the most recent project", async () => {
    vi.mocked(workspaceApi.listProjects).mockResolvedValue([workspace.project]);
    vi.mocked(workspaceApi.getWorkspace).mockResolvedValue(workspace);

    await useWorkspaceStore.getState().loadProjects();

    expect(useWorkspaceStore.getState().workspace).toEqual(workspace);
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it("exports and imports versioned project backups", async () => {
    useWorkspaceStore.setState({ workspace, projects: [workspace.project] });
    vi.mocked(fileApi.exportProject).mockResolvedValue(true);
    expect(await useWorkspaceStore.getState().exportProject("json")).toBe(true);
    expect(fileApi.exportProject).toHaveBeenCalledWith(
      "project-1",
      "Research",
      "json"
    );

    const imported = {
      ...workspace,
      project: { ...workspace.project, id: "project-2", title: "Imported" },
      cards: [{ ...workspace.cards[0], id: "card-2", projectId: "project-2" }]
    };
    vi.mocked(fileApi.importProject).mockResolvedValue(imported);
    vi.mocked(knowledgeApi.favoriteTurnIds).mockResolvedValue(["turn-1"]);
    expect(await useWorkspaceStore.getState().importProject()).toBe(true);
    expect(useWorkspaceStore.getState().workspace).toEqual(imported);
    expect(useWorkspaceStore.getState().projects[0].id).toBe("project-2");
    expect(useWorkspaceStore.getState().favoriteTurnIds).toEqual(["turn-1"]);
  });

  it("leaves workspace unchanged when file dialogs are cancelled", async () => {
    useWorkspaceStore.setState({ workspace });
    vi.mocked(fileApi.importProject).mockResolvedValue(null);
    expect(await useWorkspaceStore.getState().importProject()).toBe(false);
    expect(useWorkspaceStore.getState().workspace).toEqual(workspace);
  });

  it("imports, deduplicates, and deletes local documents", async () => {
    useWorkspaceStore.setState({ workspace });
    const document = {
      id: "d1",
      projectId: "project-1",
      name: "notes.md",
      mimeType: "text/markdown",
      localPath: "/managed/d1.md",
      contentHash: "hash",
      status: "ready",
      createdAt: ""
    };
    vi.mocked(documentApi.import).mockResolvedValue({
      document,
      duplicate: false
    });
    expect(await useWorkspaceStore.getState().importDocument()).toBe(true);
    expect(useWorkspaceStore.getState().documents).toEqual([document]);

    vi.mocked(documentApi.import).mockResolvedValue({
      document,
      duplicate: true
    });
    await useWorkspaceStore.getState().importDocument();
    expect(useWorkspaceStore.getState().documents).toEqual([document]);

    vi.mocked(documentApi.delete).mockResolvedValue();
    await useWorkspaceStore.getState().deleteDocument("d1");
    expect(useWorkspaceStore.getState().documents).toEqual([]);
  });

  it("adds traceable nodes and edges to Mindscape", async () => {
    useWorkspaceStore.setState({ workspace });
    const node = {
      id: "n1",
      projectId: "project-1",
      label: "Concept",
      description: "Traceable",
      sourceCardId: "card-1",
      sourceTurnId: null,
      positionX: 0,
      positionY: 0,
      createdAt: ""
    };
    vi.mocked(mindscapeApi.createNode).mockResolvedValue(node);
    vi.mocked(mindscapeApi.get).mockResolvedValue({
      nodes: [node],
      edges: [],
      sources: []
    });
    await useWorkspaceStore.getState().addMindNode({
      projectId: "project-1",
      label: "Concept",
      description: "Traceable",
      sourceCardId: "card-1"
    });
    expect(useWorkspaceStore.getState().mindscape.nodes).toEqual([node]);

    vi.mocked(mindscapeApi.createEdge).mockResolvedValue({
      id: "e1",
      projectId: "project-1",
      sourceId: "n1",
      targetId: "n2",
      relation: "supports",
      createdAt: ""
    });
    await useWorkspaceStore.getState().addMindEdge({
      projectId: "project-1",
      sourceId: "n1",
      targetId: "n2",
      relation: "supports"
    });
    expect(mindscapeApi.createEdge).toHaveBeenCalled();
  });

  it("keeps AI suggestions ephemeral until accepted", async () => {
    useWorkspaceStore.setState({
      workspace,
      activeModelProfileId: "m1"
    });
    const suggestions = {
      projectId: "project-1",
      sourceCardId: "card-1",
      concepts: [{
        id: "suggestion-1",
        label: "Concept",
        description: "Description"
      }],
      relations: [],
      merges: []
    };
    vi.mocked(mindscapeApi.suggest).mockResolvedValue(suggestions);
    await useWorkspaceStore.getState().suggestMindscape("card-1");
    expect(useWorkspaceStore.getState().mindSuggestions).toEqual(suggestions);

    await useWorkspaceStore.getState().applyMindSuggestions([]);
    expect(mindscapeApi.applySuggestions).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().mindSuggestions).toBeNull();
  });

  it("applies accepted suggestions and persists moved nodes", async () => {
    useWorkspaceStore.setState({
      workspace,
      mindSuggestions: {
        projectId: "project-1",
        sourceCardId: "card-1",
        concepts: [{
          id: "suggestion-1",
          label: "Concept",
          description: ""
        }],
        relations: [],
        merges: []
      }
    });
    const node = {
      id: "n1",
      projectId: "project-1",
      label: "Concept",
      description: "",
      sourceCardId: "card-1",
      sourceTurnId: null,
      positionX: 120,
      positionY: 80,
      createdAt: ""
    };
    const graph = { nodes: [node], edges: [], sources: [] };
    vi.mocked(mindscapeApi.applySuggestions).mockResolvedValue(graph);
    await useWorkspaceStore.getState().applyMindSuggestions(["suggestion-1"]);
    expect(useWorkspaceStore.getState().mindscape).toEqual(graph);
    expect(useWorkspaceStore.getState().mindSuggestions).toBeNull();

    vi.mocked(mindscapeApi.updateNode).mockResolvedValue({
      ...node,
      positionX: 200
    });
    await useWorkspaceStore.getState().updateMindNode(
      "n1",
      "Concept",
      "",
      200,
      80
    );
    expect(useWorkspaceStore.getState().mindscape.nodes[0].positionX).toBe(200);
  });

  it("reports missing model configuration for AI suggestions", async () => {
    useWorkspaceStore.setState({
      workspace,
      activeModelProfileId: null
    });
    await useWorkspaceStore.getState().suggestMindscape("card-1");
    expect(useWorkspaceStore.getState().error).toContain("Configure");
    expect(mindscapeApi.suggest).not.toHaveBeenCalled();
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

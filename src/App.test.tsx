import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useWorkspaceStore } from "./store/workspace";
import type { ProjectWorkspace } from "./types";

vi.mock("./lib/ipc", () => ({
  workspaceApi: {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getWorkspace: vi.fn()
  },
  modelApi: { list: vi.fn().mockResolvedValue([]) },
  chatApi: { send: vi.fn(), cancel: vi.fn() },
  cardApi: { create: vi.fn(), createFromSelection: vi.fn(), rename: vi.fn() },
  quoteApi: { create: vi.fn() },
  turnApi: { edit: vi.fn(), delete: vi.fn(), regenerate: vi.fn() },
  fileApi: {
    exportProject: vi.fn().mockResolvedValue(false),
    importProject: vi.fn().mockResolvedValue(null)
  },
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
    search: vi.fn().mockResolvedValue([]),
    toggleFavorite: vi.fn(),
    favoriteTurnIds: vi.fn().mockResolvedValue([])
  }
}));

const workspaceFixture: ProjectWorkspace = {
  project: {
    id: "p1", folderId: null, title: "Research", description: "",
    systemPrompt: "", defaultModelProfileId: null, rootCardId: "c1",
    archived: false, createdAt: "", updatedAt: ""
  },
  cards: [{
    id: "c1", projectId: "p1", parentId: null, relation: "root",
    branchFromTurnId: null, title: "Research", summary: "",
    contextSnapshotHash: "", contextStale: false, unread: false,
    positionX: 0, positionY: 0, createdAt: "", updatedAt: ""
  }],
  turns: [],
  selectionCardLinks: []
};

describe("App", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [],
      workspace: null,
      loading: false,
      error: null,
      activeCardId: null,
      pendingQuotes: [],
      documents: [],
      documentCitations: []
      ,mindscape: { nodes: [], edges: [], sources: [] }
      ,mindSuggestions: null,
      suggestingMindscape: false
    });
  });

  it("renders the empty local workspace", async () => {
    render(<App />);
    expect(await screen.findByText("Turn a conversation into a map.")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workspace actions" })).toBeInTheDocument();
  });

  it("opens the new project form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByRole("textbox", { name: "Project title" })).toHaveFocus();
  });

  it("creates a named project from the sidebar form", async () => {
    const user = userEvent.setup();
    const createProject = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ createProject });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByRole("textbox", { name: "Project title" }), "New research");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(createProject).toHaveBeenCalledWith("New research");
    expect(screen.queryByRole("textbox", { name: "Project title" })).not.toBeInTheDocument();
  });

  it("renders a selected project and card", () => {
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: workspaceFixture
    });

    render(<App />);

    expect(screen.getByRole("heading", { name: "Research", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Card tree" })).toBeInTheDocument();
  });

  it("shows removable quote tags inside the message composer", async () => {
    const user = userEvent.setup();
    const removeQuote = vi.fn();
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: workspaceFixture,
      pendingQuotes: [{
        id: "quote-1",
        turnId: "turn-1",
        targetTurnId: null,
        selectedText: "selected context",
        startOffset: 0,
        endOffset: 16,
        createdAt: ""
      }],
      removeQuote
    });

    render(<App />);

    const composer = screen.getByRole("textbox", { name: "Message" }).closest("form");
    expect(composer).toContainElement(screen.getByText("selected context"));
    await user.click(screen.getByRole("button", { name: "Remove quote selected context" }));
    expect(removeQuote).toHaveBeenCalledWith("quote-1");
  });

  it("opens linked card history from marked assistant text", async () => {
    const user = userEvent.setup();
    const linkedWorkspace: ProjectWorkspace = {
      ...workspaceFixture,
      cards: [
        workspaceFixture.cards[0],
        {
          ...workspaceFixture.cards[0],
          id: "c2",
          parentId: "c1",
          relation: "child",
          title: "beta"
        }
      ],
      turns: [
        {
          id: "t1", cardId: "c1", userContent: "Explain",
          assistantContent: "Alpha **beta** gamma", modelProfileId: "m1",
          status: "completed", errorMessage: null, requestId: null,
          createdAt: "", updatedAt: ""
        },
        {
          id: "t2", cardId: "c2", userContent: "Why beta?",
          assistantContent: "Linked history", modelProfileId: "m1",
          status: "completed", errorMessage: null, requestId: null,
          createdAt: "", updatedAt: ""
        }
      ],
      selectionCardLinks: [{
        id: "link-1",
        sourceTurnId: "t1",
        targetCardId: "c2",
        selectedText: "beta",
        startOffset: 6,
        endOffset: 10,
        createdAt: ""
      }]
    };
    useWorkspaceStore.setState({
      projects: [linkedWorkspace.project],
      workspace: linkedWorkspace,
      activeCardId: "c1"
    });

    render(<App />);
    window.getSelection()?.removeAllRanges();
    fireEvent.click(screen.getByRole("button", { name: "Open linked card for beta" }));

    expect(screen.getByRole("complementary", { name: "Linked card beta" })).toBeInTheDocument();
    expect(screen.getByText("Linked history")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open card beta" }));
    expect(useWorkspaceStore.getState().activeCardId).toBe("c2");
  });
});

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
  cardApi: {
    create: vi.fn(),
    createFromSelection: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn()
  },
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
      activeRequestId: null,
      activeRequestCardId: null,
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
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
  });

  it("focuses workspace search with the command palette shortcut", async () => {
    render(<App />);
    const search = screen.getByRole("textbox", { name: "Search workspace" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(search).toHaveFocus();
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

  it("exports a project from the compact workspace menu", async () => {
    const user = userEvent.setup();
    const exportProject = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: workspaceFixture,
      activeCardId: "c1",
      exportProject
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Export JSON" }));

    expect(exportProject).toHaveBeenCalledWith("json");
  });

  it("renames a card with an accessible in-app dialog", async () => {
    const user = userEvent.setup();
    const renameCard = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: workspaceFixture,
      activeCardId: "c1",
      renameCard
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Card actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename card" }));
    const input = screen.getByRole("textbox", { name: "Card title" });
    await user.clear(input);
    await user.type(input, "Systems map");
    await user.click(screen.getByRole("button", { name: "Save title" }));

    expect(renameCard).toHaveBeenCalledWith("c1", "Systems map");
    expect(screen.queryByRole("dialog", { name: "Rename card" })).not.toBeInTheDocument();
  });

  it("closes the rename dialog with Escape and restores focus", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: workspaceFixture,
      activeCardId: "c1"
    });
    render(<App />);

    const trigger = screen.getByRole("button", { name: "Card actions" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Rename card" }));
    expect(screen.getByRole("dialog", { name: "Rename card" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Rename card" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("confirms document deletion in an in-app dialog", async () => {
    const user = userEvent.setup();
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    const document = {
      id: "d1",
      projectId: "p1",
      name: "量子计算研究笔记.pdf",
      mimeType: "application/pdf",
      localPath: "/tmp/research.pdf",
      contentHash: "hash",
      status: "ready",
      createdAt: ""
    };
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: workspaceFixture,
      activeCardId: "c1",
      documents: [document],
      deleteDocument
    });
    render(<App />);

    await user.click(screen.getByRole("button", {
      name: "Delete document 量子计算研究笔记.pdf"
    }));
    expect(screen.getByRole("dialog", {
      name: "Delete 量子计算研究笔记.pdf"
    })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete document" }));

    expect(deleteDocument).toHaveBeenCalledWith("d1");
  });

  it("renders mixed Chinese and English workspace content without changing semantics", () => {
    const chineseWorkspace: ProjectWorkspace = {
      ...workspaceFixture,
      project: {
        ...workspaceFixture.project,
        title: "格点研究 Lattice"
      },
      cards: [{
        ...workspaceFixture.cards[0],
        title: "非线性思考：从对话到知识网络"
      }],
      turns: [{
        id: "t-zh",
        cardId: "c1",
        userContent: "请解释 context graph 与卡片分支的关系。",
        assistantContent: "每张卡片保留独立上下文，同时通过关系图连接。",
        modelProfileId: "m1",
        status: "completed",
        errorMessage: null,
        requestId: null,
        createdAt: "",
        updatedAt: ""
      }]
    };
    useWorkspaceStore.setState({
      projects: [chineseWorkspace.project],
      workspace: chineseWorkspace,
      activeCardId: "c1"
    });

    render(<App />);

    expect(screen.getByRole("heading", { name: "格点研究 Lattice" })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: "非线性思考：从对话到知识网络",
      level: 2
    })).toBeInTheDocument();
    expect(screen.getByText("每张卡片保留独立上下文，同时通过关系图连接。")).toBeInTheDocument();
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

  it("deletes the active child only after showing subtree counts", async () => {
    const user = userEvent.setup();
    const child = {
      ...workspaceFixture.cards[0],
      id: "c2",
      parentId: "c1",
      relation: "child" as const,
      title: "Child"
    };
    const childTurn = {
      id: "t2", cardId: "c2", userContent: "Question",
      assistantContent: "Answer", modelProfileId: "m1",
      status: "completed" as const, errorMessage: null, requestId: null,
      createdAt: "", updatedAt: ""
    };
    const deleteCard = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      projects: [workspaceFixture.project],
      workspace: {
        ...workspaceFixture,
        cards: [...workspaceFixture.cards, child],
        turns: [childTurn]
      },
      activeCardId: "c2",
      deleteCard
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Card actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete card" }));

    expect(deleteCard).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete Child" });
    expect(dialog).toHaveTextContent(
      "This permanently removes 1 card, 0 descendants, and 1 message."
    );
    await user.click(screen.getByRole("button", { name: "Cancel card deletion" }));
    expect(screen.queryByRole("dialog", { name: "Delete Child" })).not.toBeInTheDocument();
    expect(deleteCard).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Card actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete card" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(deleteCard).toHaveBeenCalledWith("c2");
  });
});

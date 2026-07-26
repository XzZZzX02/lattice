import { render, screen } from "@testing-library/react";
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
  cardApi: { create: vi.fn(), rename: vi.fn() },
  quoteApi: { create: vi.fn() },
  turnApi: { edit: vi.fn(), delete: vi.fn(), regenerate: vi.fn() },
  fileApi: {
    exportProject: vi.fn().mockResolvedValue(false),
    importProject: vi.fn().mockResolvedValue(null)
  },
  knowledgeApi: {
    search: vi.fn().mockResolvedValue([]),
    toggleFavorite: vi.fn(),
    favoriteTurnIds: vi.fn().mockResolvedValue([])
  }
}));

describe("App", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [],
      workspace: null,
      loading: false,
      error: null
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
    const workspace: ProjectWorkspace = {
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
      turns: []
    };
    useWorkspaceStore.setState({ projects: [workspace.project], workspace });

    render(<App />);

    expect(screen.getByRole("heading", { name: "Research", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Card tree" })).toBeInTheDocument();
  });
});

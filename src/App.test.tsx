import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useWorkspaceStore } from "./store/workspace";

vi.mock("./lib/ipc", () => ({
  workspaceApi: {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getWorkspace: vi.fn()
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
});

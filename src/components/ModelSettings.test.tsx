import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { modelApi } from "../lib/ipc";
import { ModelSettings } from "./ModelSettings";

vi.mock("../lib/ipc", () => ({
  modelApi: {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn()
  }
}));

describe("ModelSettings", () => {
  it("saves an Ollama profile without requesting an API key", async () => {
    const user = userEvent.setup();
    vi.mocked(modelApi.save).mockResolvedValue({
      id: "m1",
      name: "Local Qwen",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "qwen3",
      keychainRef: null,
      createdAt: "",
      updatedAt: ""
    });
    render(<ModelSettings open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Local Qwen");
    await user.type(screen.getByLabelText("Model"), "qwen3");
    await user.click(screen.getByRole("button", { name: "Save model" }));

    expect(modelApi.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "ollama", model: "qwen3" })
    );
    expect(await screen.findByText("Local Qwen")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MindscapePanel } from "./MindscapePanel";

describe("MindscapePanel", () => {
  it("shows a traceable concept graph", () => {
    render(
      <MindscapePanel
        graph={{
          nodes: [{
            id: "n1",
            projectId: "p1",
            label: "Online Softmax",
            description: "",
            sourceCardId: "c1",
            sourceTurnId: null,
            positionX: 0,
            positionY: 0,
            createdAt: ""
          }],
          edges: [],
          sources: [{
            id: "s1",
            mindNodeId: "n1",
            cardId: "c1",
            turnId: null,
            createdAt: ""
          }]
        }}
        onOpenSource={vi.fn()}
        onConnect={vi.fn()}
        onMove={vi.fn()}
        suggestions={null}
        suggesting={false}
        onSuggest={vi.fn()}
        onApplySuggestions={vi.fn()}
        onDismissSuggestions={vi.fn()}
      />
    );
    expect(screen.getByRole("complementary", { name: "Mindscape graph" })).toBeInTheDocument();
    expect(screen.getByText("Online Softmax")).toBeInTheDocument();
  });

  it("requires an explicit decision for AI suggestions", async () => {
    const user = userEvent.setup();
    const onDismissSuggestions = vi.fn();
    render(
      <MindscapePanel
        graph={{ nodes: [], edges: [], sources: [] }}
        onOpenSource={vi.fn()}
        onConnect={vi.fn()}
        onMove={vi.fn()}
        suggestions={{
          projectId: "p1",
          sourceCardId: "c1",
          concepts: [{ id: "s1", label: "Tiling", description: "" }],
          relations: [],
          merges: []
        }}
        suggesting={false}
        onSuggest={vi.fn()}
        onApplySuggestions={vi.fn()}
        onDismissSuggestions={onDismissSuggestions}
      />
    );
    expect(screen.getByText("Concept · Tiling")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reject all" }));
    expect(onDismissSuggestions).toHaveBeenCalledOnce();
  });
});

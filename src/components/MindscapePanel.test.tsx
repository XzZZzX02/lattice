import { render, screen } from "@testing-library/react";
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
      />
    );
    expect(screen.getByRole("complementary", { name: "Mindscape graph" })).toBeInTheDocument();
    expect(screen.getByText("Online Softmax")).toBeInTheDocument();
  });
});

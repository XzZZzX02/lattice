import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "../types";
import { buildCardGraph } from "../lib/cardGraph";
import { CardNavigator } from "./CardNavigator";

function card(index: number): Card {
  return {
    id: `card-${index}`,
    projectId: "project",
    parentId: index === 0 ? null : `card-${Math.floor((index - 1) / 2)}`,
    relation: index === 0 ? "root" : index % 3 === 0 ? "branch" : "child",
    branchFromTurnId: null,
    title: `Card ${index}`,
    summary: "",
    contextSnapshotHash: "",
    contextStale: index === 9,
    unread: index === 4,
    positionX: 0,
    positionY: 0,
    createdAt: "",
    updatedAt: ""
  };
}

describe("buildCardGraph", () => {
  it("maps 500 cards without losing edges or state semantics", () => {
    const cards = Array.from({ length: 500 }, (_, index) => card(index));
    const started = performance.now();
    const graph = buildCardGraph(cards, "card-250");

    expect(graph.nodes).toHaveLength(500);
    expect(graph.edges).toHaveLength(499);
    expect(graph.nodes.find((node) => node.id === "card-250")?.className).toContain("active");
    expect(graph.nodes.find((node) => node.id === "card-9")?.data.label).toContain("⚠");
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("offers deletion for child nodes but never for the root", async () => {
    const onDelete = vi.fn();
    const { container } = render(
      <CardNavigator
        activeCardId="card-0"
        cards={[card(0), card(1)]}
        deletionDisabled={false}
        onDelete={onDelete}
        onSelect={vi.fn()}
      />
    );

    expect(
      container.querySelector('button[aria-label="Delete card Card 0"]')
    ).toBeNull();
    const deleteButton = container.querySelector(
      'button[aria-label="Delete card Card 1"]'
    );
    expect(deleteButton).not.toBeNull();
    fireEvent.click(deleteButton!);
    expect(onDelete).toHaveBeenCalledWith("card-1");
  });
});

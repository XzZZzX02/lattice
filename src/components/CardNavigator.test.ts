import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { buildCardGraph } from "./CardNavigator";

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
});

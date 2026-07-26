import { describe, expect, it } from "vitest";
import type { Card, Turn } from "../types";
import { summarizeCardSubtree } from "./cardTree";

function card(index: number): Card {
  return {
    id: `card-${index}`,
    projectId: "project",
    parentId: index === 0 ? null : `card-${Math.floor((index - 1) / 2)}`,
    relation: index === 0 ? "root" : "child",
    branchFromTurnId: null,
    title: `Card ${index}`,
    summary: "",
    contextSnapshotHash: "",
    contextStale: false,
    unread: false,
    positionX: 0,
    positionY: 0,
    createdAt: "",
    updatedAt: ""
  };
}

describe("summarizeCardSubtree", () => {
  it("counts a 500-card subtree and only its messages", () => {
    const cards = Array.from({ length: 500 }, (_, index) => card(index));
    const turns = [
      { id: "turn-1", cardId: "card-1" },
      { id: "turn-2", cardId: "card-3" },
      { id: "turn-outside", cardId: "card-2" }
    ] as Turn[];

    const summary = summarizeCardSubtree(cards, turns, "card-1")!;

    expect(summary.cardIds).toContain("card-255");
    expect(summary.cardIds).not.toContain("card-2");
    expect(summary.cardCount).toBe(255);
    expect(summary.descendantCount).toBe(254);
    expect(summary.turnCount).toBe(2);
  });

  it("returns null for an unknown card", () => {
    expect(summarizeCardSubtree([card(0)], [], "missing")).toBeNull();
  });
});

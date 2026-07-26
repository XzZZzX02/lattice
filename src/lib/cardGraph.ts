import type { Edge, Node } from "@xyflow/react";
import type { Card } from "../types";

const relationColor = {
  root: "#67e88c",
  child: "#62d98a",
  divergent: "#a68ae8",
  branch: "#e9bd69"
};

export function buildCardGraph(cards: Card[], activeCardId: string | null) {
  const nodes: Node[] = cards.map((card, index) => ({
    id: card.id,
    position: {
      x: card.positionX || (index % 5) * 130,
      y: card.positionY || Math.floor(index / 5) * 90
    },
    data: { label: `${card.contextStale ? "⚠ " : ""}${card.title}` },
    className: card.id === activeCardId ? "map-node active" : `map-node ${card.relation}`,
    style: { borderColor: relationColor[card.relation] }
  }));
  const edges: Edge[] = cards
    .filter((card) => card.parentId)
    .map((card) => ({
      id: `${card.parentId}-${card.id}`,
      source: card.parentId!,
      target: card.id,
      animated: card.unread,
      style: {
        stroke: relationColor[card.relation],
        strokeDasharray: card.relation === "branch" ? "5 4" : undefined
      }
    }));
  return { nodes, edges };
}

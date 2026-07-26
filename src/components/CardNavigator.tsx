import { useMemo } from "react";
import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow
} from "@xyflow/react";
import type { Card } from "../types";

interface CardNavigatorProps {
  cards: Card[];
  activeCardId: string | null;
  onSelect: (cardId: string) => void;
}

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

export function CardNavigator({ cards, activeCardId, onSelect }: CardNavigatorProps) {
  const graph = useMemo(
    () => buildCardGraph(cards, activeCardId),
    [activeCardId, cards]
  );

  return (
    <aside className="navigator" aria-label="Card tree">
      <p className="eyebrow">Card map</p>
      <div className="flow-map">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => onSelect(node.id)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#29302b" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </aside>
  );
}

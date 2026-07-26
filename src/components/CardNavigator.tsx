import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow
} from "@xyflow/react";
import type { Card } from "../types";
import { buildCardGraph } from "../lib/cardGraph";

interface CardNavigatorProps {
  cards: Card[];
  activeCardId: string | null;
  onSelect: (cardId: string) => void;
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

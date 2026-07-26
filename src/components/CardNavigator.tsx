import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow
} from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { Card } from "../types";
import { buildCardGraph } from "../lib/cardGraph";

interface CardNavigatorProps {
  cards: Card[];
  activeCardId: string | null;
  deletionDisabled: boolean;
  onDelete: (cardId: string) => void;
  onSelect: (cardId: string) => void;
}

export function CardNavigator({
  cards,
  activeCardId,
  deletionDisabled,
  onDelete,
  onSelect
}: CardNavigatorProps) {
  const graph = useMemo(
    () => {
      const built = buildCardGraph(cards, activeCardId);
      const cardsById = new Map(cards.map((card) => [card.id, card]));
      return {
        ...built,
        nodes: built.nodes.map((node) => {
          const card = cardsById.get(node.id);
          return {
            ...node,
            data: {
              ...node.data,
              label: (
                <span className="card-map-content">
                  <span>{String(node.data.label)}</span>
                  {card?.relation !== "root" && (
                    <button
                      aria-label={`Delete card ${card?.title ?? ""}`}
                      className="nodrag nopan"
                      disabled={deletionDisabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (card) onDelete(card.id);
                      }}
                      type="button"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </span>
              )
            }
          };
        })
      };
    },
    [activeCardId, cards, deletionDisabled, onDelete]
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

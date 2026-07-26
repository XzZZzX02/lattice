import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Node
} from "@xyflow/react";
import type { MindscapeGraph } from "../types";

interface MindscapePanelProps {
  graph: MindscapeGraph;
  onOpenSource: (cardId: string) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onMove: (
    nodeId: string,
    label: string,
    description: string,
    positionX: number,
    positionY: number
  ) => void;
}

export function MindscapePanel({
  graph,
  onOpenSource,
  onConnect,
  onMove
}: MindscapePanelProps) {
  const nodes = useMemo(
    () => graph.nodes.map((node) => ({
      id: node.id,
      position: { x: node.positionX, y: node.positionY },
      data: { label: node.label },
      className: "mind-node"
    })),
    [graph.nodes]
  );
  const edges = useMemo(
    () => graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      label: edge.relation,
      animated: false
    })),
    [graph.edges]
  );
  const connect = (connection: Connection) => {
    if (connection.source && connection.target) {
      onConnect(connection.source, connection.target);
    }
  };
  const move = (_event: MouseEvent | TouchEvent, flowNode: Node) => {
    const node = graph.nodes.find((candidate) => candidate.id === flowNode.id);
    if (node) {
      onMove(
        node.id,
        node.label,
        node.description,
        flowNode.position.x,
        flowNode.position.y
      );
    }
  };

  return (
    <aside className="mindscape-panel" aria-label="Mindscape graph">
      <p className="eyebrow">Mindscape · {graph.nodes.length} concepts</p>
      {graph.nodes.length === 0 ? (
        <p className="empty-copy">Add a Card or answer to begin a traceable concept map.</p>
      ) : (
        <div className="mind-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            minZoom={0.25}
            maxZoom={2}
            onConnect={connect}
            onNodeDoubleClick={(_event, node) => {
              const source = graph.sources.find(
                (candidate) => candidate.mindNodeId === node.id
              );
              if (source?.cardId) onOpenSource(source.cardId);
            }}
            onNodeDragStop={move}
          >
            <Background color="#2f3832" gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </aside>
  );
}

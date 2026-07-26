import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Node
} from "@xyflow/react";
import type { MindscapeGraph, MindSuggestionSet } from "../types";

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
  suggestions: MindSuggestionSet | null;
  suggesting: boolean;
  onSuggest: () => void;
  onApplySuggestions: (acceptedIds: string[]) => void;
  onDismissSuggestions: () => void;
}

export function MindscapePanel({
  graph,
  onOpenSource,
  onConnect,
  onMove,
  suggestions,
  suggesting,
  onSuggest,
  onApplySuggestions,
  onDismissSuggestions
}: MindscapePanelProps) {
  const [acceptedIds, setAcceptedIds] = useState<string[]>(() =>
    suggestions ? [
      ...suggestions.concepts.map((suggestion) => suggestion.id),
      ...suggestions.relations.map((suggestion) => suggestion.id),
      ...suggestions.merges.map((suggestion) => suggestion.id)
    ] : []
  );
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
      <div className="mindscape-heading">
        <p className="eyebrow">Mindscape · {graph.nodes.length} concepts</p>
        <button disabled={suggesting} onClick={onSuggest}>
          {suggesting ? "Thinking…" : "Suggest"}
        </button>
      </div>
      {suggestions && (
        <div className="suggestion-panel">
          <strong>Review AI suggestions</strong>
          {[
            ...suggestions.concepts.map((item) => ({
              id: item.id,
              label: `Concept · ${item.label}`
            })),
            ...suggestions.relations.map((item) => ({
              id: item.id,
              label: `Relation · ${item.relation}`
            })),
            ...suggestions.merges.map((item) => ({
              id: item.id,
              label: `Merge · ${item.reason || "duplicate concepts"}`
            }))
          ].map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={acceptedIds.includes(item.id)}
                onChange={(event) => setAcceptedIds((current) =>
                  event.target.checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id)
                )}
              />
              {item.label}
            </label>
          ))}
          <footer>
            <button onClick={onDismissSuggestions}>Reject all</button>
            <button onClick={() => onApplySuggestions(acceptedIds)}>Apply selected</button>
          </footer>
        </div>
      )}
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

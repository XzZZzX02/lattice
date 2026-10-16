import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow, applyNodeChanges, type Edge, type Node } from "@xyflow/react";
import { ArrowUpRight, BrainCircuit, Trash2 } from "lucide-react";
import type { Presentation, PresentationMutation } from "./types";

export function MindMap({ presentation, mutate, locate }: { presentation: Presentation; mutate: (mutation: PresentationMutation) => Promise<boolean>; locate: (messageId: string, excerptId: string) => void }) {
  const initial = useMemo<Node[]>(() => presentation.mindNodes.map((node) => ({ id: node.id, position: { x: node.x, y: node.y }, data: { label: <span className="mind-node-label">{node.label}</span> }, style: { border: "1px solid #3f536c", background: "#121924", color: "#f2f6fa", borderRadius: 9, fontSize: 12, width: 170 } })), [presentation.mindNodes]);
  const [nodeState, setNodeState] = useState({ source: initial, nodes: initial });
  let nodes = nodeState.nodes;
  if (nodeState.source !== initial) {
    nodes = initial;
    setNodeState({ source: initial, nodes: initial });
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const edges: Edge[] = presentation.mindEdges.map((edge) => ({ ...edge, type: "smoothstep", selected: edge.id === edgeId, style: { stroke: edge.id === edgeId ? "#e9b96e" : "#71b7ff" }, labelStyle: { fill: "#c8d1dc", fontSize: 11 }, labelBgStyle: { fill: "#0d121a" } }));
  const activeNode = presentation.mindNodes.find((node) => node.id === selected);
  const activeEdge = presentation.mindEdges.find((edge) => edge.id === edgeId);

  return <div className="mind-view"><div className="section-intro"><BrainCircuit size={20} /><h2>把片段连成自己的思路</h2><p>在摘录卡片上点击“加入思维图”。拖动节点整理位置，从节点的圆点拖线建立联系。</p></div><div className="mind-map" aria-label="摘录思维图"><ReactFlow nodes={nodes} edges={edges} onNodesChange={(changes) => setNodeState((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }))} onNodeDragStop={(_, node) => void mutate({ type: "mind:update", id: node.id, x: node.position.x, y: node.position.y })} onConnect={(connection) => { if (connection.source && connection.target) void mutate({ type: "mind:connect", edge: { id: crypto.randomUUID(), source: connection.source, target: connection.target, label: "关联" } }); }} onNodeClick={(_, node) => { setSelected(node.id); setEdgeId(null); }} onEdgeClick={(_, edge) => { setEdgeId(edge.id); setSelected(null); }} onPaneClick={() => { setSelected(null); setEdgeId(null); }} deleteKeyCode={null} fitView minZoom={0.2} maxZoom={1} proOptions={{ hideAttribution: true }}><Background color="#2a3646" gap={20} /><Controls showInteractive={false} /></ReactFlow></div>
    {!nodes.length && <p className="empty-caption">先在“摘录”中选一个片段加入思维图。</p>}
    {activeNode && <div className="graph-detail"><label>概念名称<input key={`${activeNode.id}:${activeNode.label}`} aria-label="概念名称" defaultValue={activeNode.label} maxLength={120} onBlur={(event) => { if (event.target.value !== activeNode.label) void mutate({ type: "mind:update", id: activeNode.id, label: event.target.value }); }} /></label><div className="card-footer"><button className="text-button" onClick={() => locate(activeNode.messageId, activeNode.excerptId)}>定位来源<ArrowUpRight size={13} /></button><button className="icon-button" aria-label="删除思维图节点" onClick={() => void mutate({ type: "mind:remove", id: activeNode.id })}><Trash2 size={14} /></button></div></div>}
    {activeEdge && <div className="graph-detail"><label>关系<input key={`${activeEdge.id}:${activeEdge.label}`} aria-label="关系名称" defaultValue={activeEdge.label} maxLength={80} onBlur={(event) => { if (event.target.value !== activeEdge.label) void mutate({ type: "mind:connect", edge: { ...activeEdge, label: event.target.value.slice(0, 80) } }); }} /></label><button className="text-button" onClick={() => void mutate({ type: "mind:disconnect", id: activeEdge.id })}>删除这条关系</button></div>}
  </div>;
}

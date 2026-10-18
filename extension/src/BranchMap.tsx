import { useMemo } from "react";
import { Background, Controls, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { ExternalLink, GitBranch } from "lucide-react";
import { connectedBranches } from "./presentation";
import type { BranchLink, ChatSnapshot } from "./types";
import { LinkBranch } from "./LinkBranch";

export function BranchMap({ snapshot, links }: { snapshot: ChatSnapshot; links: BranchLink[] }) {
  const connected = useMemo(() => connectedBranches(links, snapshot.conversationKey), [links, snapshot.conversationKey]);
  const graph = useMemo(() => {
    const currentKey = snapshot.conversationKey ?? "current";
    const records = new Map([[currentKey, { title: snapshot.title, url: snapshot.url }]]);
    const parents = new Map<string, string>();
    for (const link of connected) {
      if (!records.has(link.sourceKey)) records.set(link.sourceKey, { title: link.sourceTitle, url: link.sourceUrl });
      if (!records.has(link.targetKey)) records.set(link.targetKey, { title: link.targetTitle, url: link.targetUrl });
      parents.set(link.targetKey, link.sourceKey);
    }
    const depths = new Map<string, number>();
    function depth(key: string, visiting = new Set<string>()): number {
      if (depths.has(key)) return depths.get(key)!;
      if (visiting.has(key)) return 0;
      visiting.add(key);
      const parent = parents.get(key);
      const value = parent ? depth(parent, visiting) + 1 : 0;
      depths.set(key, value);
      return value;
    }
    const rows = new Map<number, number>();
    const nodes: Node[] = [...records].map(([id, record]) => {
      const column = depth(id);
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return {
        id,
        position: { x: column * 225, y: row * 110 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: <a href={record.url} title={record.title} className={id === currentKey ? "map-link current" : "map-link"}><span>{id === currentKey ? "当前会话" : "原生会话"}</span><strong>{record.title || "ChatGPT 对话"}</strong></a> },
        style: { width: 190, padding: 0, borderRadius: 10, border: id === currentKey ? "1px solid var(--accent)" : "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--text)" }
      };
    });
    const edges: Edge[] = connected.map((link) => ({ id: `${link.sourceKey}:${link.targetKey}`, source: link.sourceKey, target: link.targetKey, type: "smoothstep", style: { stroke: "var(--accent)" } }));
    return { nodes, edges };
  }, [connected, snapshot]);

  return <div className="branch-view">
    <div className="section-intro"><GitBranch size={20} /><h2>会话图</h2><p>{graph.nodes.length} 个会话 · {connected.length} 次分叉</p></div>
    <div className="branch-map" aria-label="原生会话分支图">
      <ReactFlow key={snapshot.conversationKey ?? snapshot.route} nodes={graph.nodes} edges={graph.edges} fitView minZoom={0.2} maxZoom={1.3} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
        <Background color="var(--map-grid)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="branch-list">{connected.length === 0 ? <p className="empty-caption">尚无会话分叉记录。</p> : connected.map((link) => <div className="branch-record" key={link.targetKey}>
      <span>{link.manual ? "已手动关联的原生分支" : "通过 Lattice 创建的原生分支"}</span>
      <p>{link.sourceTitle}</p>
      <a href={link.targetUrl}>{link.targetTitle || "打开分支会话"}<ExternalLink size={13} /></a>
      <a className="subtle-link" href={link.sourceUrl}>返回来源会话</a>
    </div>)}</div><LinkBranch key={snapshot.route} snapshot={snapshot} />
  </div>;
}

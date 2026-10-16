import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, Send } from "lucide-react";
import type { ChatSnapshot, Excerpt } from "./types";
import { type RemoteTurn, type TreeCard, type TreeLive } from "./tree-types";
import panelStyles from "./panel.css?inline";
import treeStyles from "./tree.css?inline";

import { useConversationTree } from "./useConversationTree";
type TreeActions = ReturnType<typeof useConversationTree>;
const labels: Record<TreeLive["phase"], string> = { preparing: "正在加载分支起点", forking: "正在创建原生分支", loading: "正在恢复支线上下文", sending: "正在发送到原生分支", waiting: "ChatGPT 正在回答", ready: "上下文已保存在原生分支", error: "需要检查原生页面" };

function ThreadCard({ card, tree, depth = 0 }: { card: TreeCard; tree: TreeActions; depth?: number }) {
  const state = tree.live[card.id];
  const busy = !!state && !["ready", "error"].includes(state.phase);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<{ id: string; text: string } | null>(null);
  const turns = state?.turns ?? [];
  useEffect(() => { if (!card.collapsed && card.targetKey && !state) void tree.resume(card); }, [card, state, tree]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("question") ?? "");
    if (!text.trim() || busy || submitting) return;
    setSubmitting(true);
    try { await tree.send(card, text); } finally { setSubmitting(false); }
  }
  function child(turn: RemoteTurn) {
    const text = selected?.id === turn.id ? selected.text : turn.text.slice(0, 120);
    const anchor: Excerpt = { id: crypto.randomUUID(), messageId: turn.id, text, startOffset: 0, endOffset: text.length, note: "", createdAt: new Date().toISOString() };
    void tree.create({ id: turn.id, stableId: /^(message|turn):/.test(turn.id) }, anchor, card);
    setSelected(null);
  }
  return <article className="thread-card" data-tree-card-id={card.id} aria-label={`支线：${card.label}`} style={{ "--depth": depth } as React.CSSProperties}>
    <header className="thread-header">
      <button className="thread-toggle" onClick={() => void tree.update(card.id, { collapsed: !card.collapsed })} aria-expanded={!card.collapsed} aria-label={`${card.collapsed ? "展开" : "收起"}支线：${card.label}`}>
        {card.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<GitBranch size={14} /><strong>{card.label}</strong><span>{turns.length ? `${turns.length} 轮` : card.targetKey ? "已保存" : "新支线"}</span>
      </button>
      <button className="icon-button" title="打开原生分支，使用文件、引用和工具" aria-label={`打开原生分支：${card.label}`} onClick={() => void tree.open(card)}><ExternalLink size={14} /></button>
    </header>
    {!card.collapsed && <div className="thread-content">
      {card.anchor && <blockquote className="thread-anchor">{card.anchor.text}</blockquote>}
      {card.targetKey && !turns.length && !busy && <p className="thread-hint">支线上下文保存在 ChatGPT。可继续提问，或打开原生分支查看完整历史。</p>}
      {!card.targetKey && !busy && <p className="thread-hint">围绕这里追问。首次发送会创建原生分支，主线保持原位。</p>}
      <div className="thread-turns">{turns.map((turn) => <section key={turn.id} className="thread-turn">
        <p className="thread-question">{turn.question}</p>
        <div className="thread-answer" onMouseUp={(event) => { const selection = event.currentTarget.getRootNode() instanceof ShadowRoot ? (event.currentTarget.getRootNode() as ShadowRoot & { getSelection?: () => Selection }).getSelection?.() ?? window.getSelection() : window.getSelection(); const text = selection?.toString().trim(); if (text) setSelected({ id: turn.id, text: text.slice(0, 2000) }); }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{turn.markdown || turn.text || "正在生成…"}</ReactMarkdown>
        </div>
        <button className="thread-child-button" disabled={!card.targetKey || busy} onClick={() => child(turn)}><GitBranch size={13} />{selected?.id === turn.id ? `追问「${selected.text.slice(0, 20)}」` : "从这条回答展开子支线"}</button>
        {tree.cards.filter((item) => item.parentId === card.id && item.sourceMessageId === turn.id).map((item) => <ThreadCard key={item.id} card={item} tree={tree} depth={depth + 1} />)}
      </section>)}</div>
      {state?.pending && busy && <p className="thread-pending">{state.pending}</p>}
      <p className={`thread-status ${state?.phase === "error" ? "is-error" : ""}`} role="status">{state ? state.error || labels[state.phase] : "仅此支线累积后续问答"}</p>
      {tree.error && <p className="thread-status is-error" role="alert">{tree.error}</p>}
      <form className="thread-composer" onSubmit={(event) => void submit(event)}>
        <textarea key={`${card.id}:${card.draft}`} name="question" defaultValue={card.draft} aria-label={`在支线中追问：${card.label}`} placeholder={turns.length ? "沿着这条支线继续问…" : "这个名词是什么意思？"} rows={2} maxLength={20000} disabled={busy || submitting} onBlur={(event) => { if (event.target.value !== card.draft) void tree.update(card.id, { draft: event.target.value }); }} />
        <button className="thread-send" type="submit" disabled={busy || submitting} aria-label={`发送支线问题：${card.label}`}><Send size={14} /><span>{busy || submitting ? "处理中" : "发送"}</span></button>
      </form>
      <p className="thread-native-note">问答由 ChatGPT 原生分支处理 · 工具与附件可在原生页继续</p>
    </div>}
  </article>;
}

interface InlineTarget { messageId: string; host: HTMLElement; container: HTMLElement }
export function InlineConversationTree({ snapshot, tree, hidden }: { snapshot: ChatSnapshot; tree: TreeActions; hidden: boolean }) {
  const targets = useRef(new Map<string, InlineTarget>());
  const [portals, setPortals] = useState<InlineTarget[]>([]);
  useLayoutEffect(() => {
    const wanted = new Set(tree.cards.filter((card) => !card.parentId).map((card) => card.sourceMessageId));
    let changed = false;
    for (const [messageId, target] of targets.current) {
      if (!wanted.has(messageId) || !snapshot.answers.some((answer) => answer.id === messageId)) { target.host.remove(); targets.current.delete(messageId); changed = true; }
    }
    for (const answer of snapshot.answers) {
      if (!wanted.has(answer.id)) continue;
      let target = targets.current.get(answer.id);
      if (!target) {
        const host = document.createElement("div");
        host.setAttribute("data-lattice-tree-host", answer.id);
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = panelStyles + treeStyles;
        const container = document.createElement("div");
        shadow.append(style, container);
        target = { messageId: answer.id, host, container };
        targets.current.set(answer.id, target);
        changed = true;
      }
      if (answer.element.nextElementSibling !== target.host) { answer.element.after(target.host); changed = true; }
      target.host.style.display = hidden ? "none" : "block";
    }
    if (changed) setPortals([...targets.current.values()]);
  }, [snapshot.answers, tree.cards, hidden]);
  useLayoutEffect(() => {
    if (!tree.focusTarget) return;
    for (const target of portals) {
      const card = [...target.container.querySelectorAll<HTMLElement>("[data-tree-card-id]")].find((item) => item.dataset.treeCardId === tree.focusTarget?.id);
      if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); break; }
    }
  }, [tree.focusTarget, portals]);
  useEffect(() => { const mounted = targets.current; return () => { for (const target of mounted.values()) target.host.remove(); mounted.clear(); }; }, []);
  return <>{portals.map((target) => createPortal(<div className="lattice inline-tree" aria-label="回答的支线对话">{tree.cards.filter((card) => !card.parentId && card.sourceMessageId === target.messageId).map((card) => <ThreadCard key={card.id} card={card} tree={tree} />)}</div>, target.container, target.messageId))}</>;
}

export function TreeOutline({ tree, messageId }: { tree: TreeActions; messageId: string }) {
  const roots = tree.cards.filter((card) => !card.parentId && card.sourceMessageId === messageId);
  function item(card: TreeCard): React.ReactNode {
    return <li key={card.id}><button className="tree-outline-link" onClick={() => void tree.focus(card)}><GitBranch size={12} /><span>{card.label}</span><small>{card.collapsed ? "已收起" : "展开中"}</small></button><ul>{tree.cards.filter((child) => child.parentId === card.id).map(item)}</ul></li>;
  }
  return roots.length ? <ul className="tree-outline">{roots.map(item)}</ul> : null;
}

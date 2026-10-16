import { useId, useMemo, useState, type RefObject } from "react";
import { Check, ChevronDown, ChevronRight, GitBranch, LayoutList, MessageSquare, Pencil, Search, Star, X } from "lucide-react";
import { conversationOutline, type ConversationNode } from "./conversation-outline";
import type { ChatSnapshot, NativeAnswer, Presentation, PresentationMutation } from "./types";
import type { useConversationTree } from "./useConversationTree";

interface Props {
  snapshot: ChatSnapshot;
  tree: ReturnType<typeof useConversationTree>;
  presentation: Presentation;
  activeId: string | null;
  ready: boolean;
  branching: boolean;
  query: string;
  setQuery: (value: string) => void;
  searchInput: RefObject<HTMLInputElement | null>;
  selectAnswer: (answer: NativeAnswer) => void;
  branch: (answer: NativeAnswer) => Promise<void>;
  mutate: (mutation: PresentationMutation) => Promise<boolean>;
}

export function ConversationNavigator({ snapshot, tree, presentation, activeId, ready, branching, query, setQuery, searchInput, selectAnswer, branch, mutate }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [focused, setFocused] = useState("main");
  const prefix = useId();
  const root = useMemo(() => conversationOutline(snapshot, presentation, tree.cards, tree.live, query, favoritesOnly), [snapshot, presentation, tree.cards, tree.live, query, favoritesOnly]);
  const searching = !!query.trim();
  const expanded = (node: ConversationNode) => searching || !collapsed.has(node.id);
  function toggle(node: ConversationNode) {
    setFocused(node.id);
    setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
  }
  function activate(node: ConversationNode) {
    if (node.card) void tree.focus(node.card);
    else if (node.answer) selectAnswer(node.answer);
    else toggle(node);
  }
  const visible: ConversationNode[] = [];
  function visit(node: ConversationNode) { visible.push(node); if (expanded(node)) node.children.forEach(visit); }
  visit(root);
  const focusId = visible.some((node) => node.id === focused) ? focused : "main";

  function keyboard(event: React.KeyboardEvent<HTMLUListElement>) {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute("data-tree-nav")) return;
    const button = event.target;
    const node = visible.find((item) => item.id === button.dataset.treeNav);
    if (!node) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tree-nav]")];
    const index = buttons.indexOf(button);
    const focus = (target?: HTMLButtonElement) => { if (target) { setFocused(target.dataset.treeNav!); target.focus(); } };
    if (event.key === "ArrowDown") focus(buttons[index + 1]);
    else if (event.key === "ArrowUp") focus(buttons[index - 1]);
    else if (event.key === "Home") focus(buttons[0]);
    else if (event.key === "End") focus(buttons.at(-1));
    else if (event.key === "ArrowRight") { if (node.children.length && !expanded(node)) toggle(node); else if (node.children.length) focus(buttons[index + 1]); }
    else if (event.key === "ArrowLeft") {
      if (node.children.length && expanded(node) && !searching) toggle(node);
      else { const parent = button.closest("[role='treeitem']")?.parentElement?.closest("[role='treeitem']"); focus(parent?.querySelector<HTMLButtonElement>("[data-tree-nav]") ?? undefined); }
    } else return;
    event.preventDefault();
  }

  function item(node: ConversationNode, level = 1): React.ReactNode {
    const answer = node.answer;
    const ordinal = (node.index ?? 0) + 1;
    const hasChildren = node.children.length > 0;
    const open = expanded(node);
    const selected = node.card ? tree.focusTarget?.id === node.card.id : !!answer && !tree.focusTarget && activeId === answer.id;
    const state = node.card ? tree.live[node.card.id] : undefined;
    const status = state?.phase === "error" ? "待检查" : state && !["ready", "error"].includes(state.phase) ? "处理中" : state?.turns.length ? `${state.turns.length} 轮` : node.card?.targetKey ? "已保存" : "未提问";
    const labelId = `${prefix}-${encodeURIComponent(node.id)}`;
    return <li key={node.id} role="treeitem" aria-labelledby={labelId} aria-level={level} aria-expanded={hasChildren ? open : undefined} aria-selected={selected} data-tree-node={node.id} data-kind={node.kind}>
      <div className={`conversation-node-row ${selected ? "is-selected" : ""}`}>
        {hasChildren ? <button className="conversation-disclosure" aria-label={`${open ? "折叠" : "展开"}节点：${node.label}`} aria-expanded={open} disabled={searching} onClick={() => toggle(node)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="conversation-leaf" />}
        <button id={labelId} data-tree-nav={node.id} className={`conversation-node-link ${node.kind === "branch" ? "tree-outline-link" : ""}`} tabIndex={focusId === node.id ? 0 : -1} onFocus={() => setFocused(node.id)} onClick={() => activate(node)} title={node.label}>
          {node.kind === "main" ? <GitBranch size={14} /> : node.kind === "answer" ? <span className="conversation-ordinal">{node.index !== undefined ? String(ordinal).padStart(2, "0") : "…"}</span> : <GitBranch size={12} />}
          {" "}<span className="conversation-node-label">{node.label}</span>{" "}
          {node.kind === "main" && <small>{snapshot.answers.length} 轮 · {tree.cards.length} 支线</small>}
          {node.card && <small className={state?.phase === "error" ? "is-error" : ""}>{selected ? "查看中" : status}</small>}
        </button>
        {answer && <div className="conversation-node-actions">
          <button className={`icon-button ${presentation.favorites.includes(answer.id) ? "starred" : ""}`} title={presentation.favorites.includes(answer.id) ? "取消置顶" : "置顶"} aria-label={`${presentation.favorites.includes(answer.id) ? "取消置顶" : "置顶"}回答 ${ordinal}`} disabled={!ready || !answer.stableId} onClick={() => void mutate({ type: "favorite", messageId: answer.id, favorite: !presentation.favorites.includes(answer.id) })}><Star size={12} fill={presentation.favorites.includes(answer.id) ? "currentColor" : "none"} /></button>
          <button className="icon-button" title="重命名" aria-label={`重命名回答 ${ordinal} 的卡片`} disabled={!ready || !answer.stableId} onClick={() => setEditing(node.id)}><Pencil size={12} /></button>
          <button className="icon-button" title="就地追问" aria-label="就地追问" disabled={branching || !snapshot.conversationKey || !answer.stableId} onClick={() => void branch(answer)}><GitBranch size={12} /></button>
        </div>}
      </div>
      {editing === node.id && answer && <form className="rename-form conversation-rename" onSubmit={(event) => { event.preventDefault(); const title = String(new FormData(event.currentTarget).get("title") ?? ""); void mutate({ type: "title", messageId: answer.id, title }).then((saved) => { if (saved) setEditing(null); }); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setEditing(null); } }}><input name="title" aria-label="卡片标题" defaultValue={presentation.titles[answer.id] || answer.question} maxLength={160} autoFocus /><button className="icon-button" aria-label="保存卡片标题"><Check size={14} /></button><button className="icon-button" type="button" aria-label="取消重命名" onClick={() => setEditing(null)}><X size={14} /></button></form>}
      {hasChildren && open && <ul role="group">{node.children.map((child) => item(child, level + 1))}</ul>}
    </li>;
  }

  return <section className="conversation-navigator">
    <div className="answer-tools"><label className="search"><Search size={14} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主线与支线" aria-label="搜索对话树" />{query && <button aria-label="清除搜索" onClick={() => setQuery("")}><X size={12} /></button>}</label><button className={`view-toggle ${favoritesOnly ? "enabled" : ""}`} aria-pressed={favoritesOnly} title="仅看置顶回答" aria-label="仅看置顶回答" onClick={() => setFavoritesOnly(!favoritesOnly)}><Star size={14} /></button><button className={`view-toggle ${presentation.cardView ? "enabled" : ""}`} aria-pressed={presentation.cardView} title="切换原文的卡片排版" disabled={!ready} onClick={() => void mutate({ type: "cardView", enabled: !presentation.cardView })}><LayoutList size={14} /></button></div>
    {root.children.length ? <ul role="tree" aria-label="当前对话树" className="conversation-tree" onKeyDown={keyboard}>{item(root)}</ul> : <div className="empty-state"><MessageSquare size={24} /><h2>{query ? "没有匹配的节点" : favoritesOnly ? "还没有置顶回答" : "让对话在这里展开"}</h2><p>{query ? "试试主线或支线中的其他关键词。" : favoritesOnly ? "点击主线节点旁的星标。" : "在 ChatGPT 中正常提问，主线和支线会出现在树中。"}</p></div>}
  </section>;
}

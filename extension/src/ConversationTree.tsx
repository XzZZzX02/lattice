import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ChevronRight, ExternalLink, GitBranch, Maximize2, Minimize2, Send, X } from "lucide-react";
import { selectionFromContainer } from "../../src/lib/selection";
import type { ChatSnapshot, Excerpt } from "./types";
import { type RemoteTurn, type TreeCard, type TreeLive } from "./tree-types";
import { linkTreeReferences, referenceRect, resolveTreeReference, type TreeReference } from "./tree-reference";
import { positionTreeCard } from "./tree-floating";
import { jumpToAnswer } from "./host";
import treeStyles from "./tree.css?inline";
import { useConversationTree } from "./useConversationTree";
import { NativeSurface } from "./NativeSurface";

type TreeActions = ReturnType<typeof useConversationTree>;
const labels: Record<TreeLive["phase"], string> = { preparing: "正在加载分支起点", forking: "正在创建原生分支", loading: "正在恢复支线上下文", sending: "正在发送到原生分支", waiting: "ChatGPT 正在回答", ready: "上下文已保存在原生分支", error: "需要检查原生页面" };
const noTurns: RemoteTurn[] = [];

function ancestry(card: TreeCard, cards: TreeCard[]) {
  const chain = [card];
  while (chain[0].parentId) {
    const parent = cards.find((item) => item.id === chain[0].parentId);
    if (!parent || chain.some((item) => item.id === parent.id)) break;
    chain.unshift(parent);
  }
  return chain;
}

function ThreadCard({ card, tree, pageUrl, expanded, expand }: { card: TreeCard; tree: TreeActions; pageUrl: string; expanded: boolean; expand: () => void }) {
  const state = tree.live[card.id];
  const busy = !!state && !["ready", "error"].includes(state.phase);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<{ id: string; anchor: Excerpt } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = useRef(() => {});
  const history = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const turns = state?.turns ?? noTurns;
  const chain = ancestry(card, tree.cards);

  useEffect(() => { if (card.targetKey && !state) void tree.resume(card); }, [card, state, tree]);
  useLayoutEffect(() => {
    persist.current = () => {
      const value = editor.current?.value;
      if (value !== undefined && value !== card.draft) void tree.update(card.id, { draft: value });
    };
    const node = editor.current;
    const root = node?.getRootNode();
    const focused = root instanceof ShadowRoot ? root.activeElement === node : document.activeElement === node;
    if (node && (busy || !focused)) node.value = card.draft;
  }, [card, tree, busy]);
  // Pointerdown dismissal can remove the editor before blur. Flush before the
  // DOM is detached so returning to the main line never loses a draft.
  useLayoutEffect(() => () => { clearTimeout(timer.current); persist.current(); }, []);
  useLayoutEffect(() => {
    if (!follow.current || !history.current) return;
    const native = turns.at(-1)?.content?.some((part) => part.type === "native");
    const last = history.current.querySelector<HTMLElement>(".thread-turn:last-of-type");
    history.current.scrollTop = native && last ? last.offsetTop - history.current.offsetTop : history.current.scrollHeight;
  }, [turns, state?.pending]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = editor.current?.value ?? "";
    if (!text.trim() || busy || submitting) return;
    clearTimeout(timer.current);
    follow.current = true;
    setSubmitting(true);
    try { await tree.send(card, text); } finally { setSubmitting(false); }
  }
  function child(turn: RemoteTurn, element: HTMLElement) {
    const raw = element.textContent ?? turn.text;
    const text = raw.trim().slice(0, 120);
    const startOffset = raw.indexOf(text);
    const anchor: Excerpt = selected?.id === turn.id ? selected.anchor : { id: crypto.randomUUID(), messageId: turn.id, text, startOffset, endOffset: startOffset + text.length, note: "", createdAt: new Date().toISOString() };
    void tree.create({ id: turn.id, stableId: /^(message|turn):/.test(turn.id) }, anchor, card);
    window.getSelection()?.removeAllRanges();
    setSelected(null);
  }
  return <article className="thread-card" data-tree-card-id={card.id} aria-label={`支线：${card.label}`}>
    <nav className="thread-breadcrumb" aria-label="当前支线路径">
      <button onClick={tree.dismiss}><ArrowLeft size={12} />返回主线</button>
      {chain.slice(0, -1).map((parent) => <span key={parent.id}><ChevronRight size={11} /><button onClick={() => void tree.focus(parent)} title={parent.label}>{parent.label}</button></span>)}
      <span><ChevronRight size={11} /><strong title={card.label}>{card.label}</strong></span>
    </nav>
    <header className="thread-header">
      <GitBranch size={15} /><strong>{card.label}</strong><span>{turns.length ? `${turns.length} 轮` : card.targetKey ? "已保存" : "新支线"}</span>
      {turns.some((turn) => turn.content?.some((part) => part.type === "native")) && <button className="icon-button" aria-label={expanded ? "收窄支线卡片" : "展开支线卡片"} onClick={expand}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
      <button className="icon-button" title="打开原生分支，使用文件、引用和工具" aria-label={`打开原生分支：${card.label}`} onClick={() => void tree.open(card)}><ExternalLink size={14} /></button>
      <button className="icon-button" aria-label={`收起支线：${card.label}`} title="回到主线时也会自动收起" onClick={tree.dismiss}><X size={16} /></button>
    </header>
    <div className="thread-history" ref={history} onScroll={() => { const node = history.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
      {card.anchor && <blockquote className="thread-anchor">{card.anchor.text}</blockquote>}
      {!turns.length && !busy && <p className="thread-hint">{card.targetKey ? "支线上下文保存在 ChatGPT，可继续提问。" : "围绕这段引用追问。首次发送会创建原生分支。"}</p>}
      {turns.map((turn) => <section key={turn.id} className="thread-turn">
        <p className="thread-question">{turn.question}</p>
        <div className="thread-answer" data-tree-message-id={turn.id} onMouseUp={(event) => {
          const root = event.currentTarget.getRootNode() as ShadowRoot & { getSelection?: () => Selection };
          const selection = root.getSelection?.() ?? window.getSelection();
          const resolved = selectionFromContainer(event.currentTarget, "", selection);
          if (resolved) setSelected({ id: turn.id, anchor: { id: crypto.randomUUID(), messageId: turn.id, text: resolved.text, startOffset: resolved.renderedStartOffset, endOffset: resolved.renderedEndOffset, note: "", createdAt: new Date().toISOString() } });
        }}>
          {(turn.content ?? [{ type: "markdown" as const, markdown: turn.markdown || turn.text || "正在生成…" }]).map((part, index) => part.type === "native" ? <NativeSurface key={`native-${part.index}`} card={card} pageUrl={pageUrl} messageId={turn.id} index={part.index} label={part.label} dismiss={tree.dismiss} select={(text) => setSelected({ id: turn.id, anchor: { id: crypto.randomUUID(), messageId: turn.id, text, startOffset: 0, endOffset: text.length, note: "", createdAt: new Date().toISOString() } })} /> : <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{part.markdown}</ReactMarkdown>)}
        </div>
        <button className="thread-child-button" disabled={!card.targetKey || busy} onClick={(event) => child(turn, event.currentTarget.previousElementSibling as HTMLElement)}><GitBranch size={13} />{selected?.id === turn.id ? `追问「${selected.anchor.text.slice(0, 20)}」` : "从这条回答展开子支线"}</button>
        <div className="thread-child-links">{tree.cards.filter((item) => item.parentId === card.id && item.sourceMessageId === turn.id).map((item) => <button key={item.id} onClick={() => void tree.focus(item)}><GitBranch size={11} />{item.label}</button>)}</div>
      </section>)}
      {state?.pending && busy && !turns.some((turn) => turn.question === state.pending) && <p className="thread-pending">{state.pending}</p>}
    </div>
    <footer className="thread-footer">
      <p className={`thread-status ${state?.phase === "error" ? "is-error" : ""}`} role="status">{state ? state.error || labels[state.phase] : "此支线独立保留后续问答"}</p>
      {tree.error && <p className="thread-status is-error" role="alert">{tree.error}</p>}
      <form className="thread-composer" onSubmit={(event) => void submit(event)}>
        <textarea ref={editor} name="question" defaultValue={card.draft} aria-label={`在支线中追问：${card.label}`} placeholder={turns.length ? "沿着这条支线继续问…" : "这个名词是什么意思？"} rows={2} maxLength={20000} disabled={busy || submitting} onChange={() => { clearTimeout(timer.current); timer.current = setTimeout(() => persist.current(), 250); }} onBlur={() => persist.current()} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <button className="thread-send" type="submit" disabled={busy || submitting} aria-label={`发送支线问题：${card.label}`}><Send size={14} /><span>{busy || submitting ? "处理中" : "发送"}</span></button>
      </form>
      <p className="thread-native-note">点击主线或滚动主线收起 · Esc 收起 · 上下文保留</p>
    </footer>
  </article>;
}

export function FloatingConversationTree({ snapshot, tree, hidden }: { snapshot: ChatSnapshot; tree: TreeActions; hidden: boolean }) {
  const surface = useRef<HTMLElement>(null);
  const references = useRef<TreeReference[]>([]);
  const actions = useRef(tree);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState(() => positionTreeCard({ left: innerWidth / 2, right: innerWidth / 2, top: 160, bottom: 180 }, { width: innerWidth, height: innerHeight }));
  const card = tree.cards.find((item) => item.id === tree.focusTarget?.id);
  const rootCard = card ? ancestry(card, tree.cards)[0] : undefined;
  const cardId = card?.id;
  const rootId = rootCard?.id;
  const sourceMessageId = rootCard?.sourceMessageId;

  useLayoutEffect(() => { actions.current = tree; }, [tree]);
  useLayoutEffect(() => {
    const matched: TreeReference[] = [];
    for (const item of tree.cards) {
      const container = !item.parentId ? snapshot.answers.find((answer) => answer.id === item.sourceMessageId)?.contentElement : item.parentId === card?.id ? [...surface.current?.querySelectorAll<HTMLElement>("[data-tree-message-id]") ?? []].find((element) => element.dataset.treeMessageId === item.sourceMessageId) : undefined;
      const reference = container ? resolveTreeReference(item, container) : null;
      if (reference) matched.push(reference);
    }
    references.current = matched;
    if (hidden) return;
    return linkTreeReferences(matched, card?.id, (item) => void actions.current.focus(item));
  }, [snapshot.answers, tree.cards, tree.live, card?.id, hidden]);

  useLayoutEffect(() => {
    if (!cardId || hidden) return;
    const source = snapshot.answers.find((answer) => answer.id === sourceMessageId);
    const reference = references.current.find((item) => item.card.id === rootId);
    if (source && reference && !referenceRect(reference)) jumpToAnswer(source);
    function place() {
      const root = surface.current?.getRootNode() as ShadowRoot | undefined;
      const panel = root?.querySelector<HTMLElement>(".panel");
      const panelRect = panel?.getBoundingClientRect();
      const right = document.documentElement.dataset.latticeLayout === "docked" && panelRect && panelRect.width && getComputedStyle(panel!).display !== "none" ? panelRect.left - 12 : innerWidth;
      const anchor = reference && referenceRect(reference) || { left: innerWidth / 2, right: innerWidth / 2, top: 160, bottom: 180 };
      const next = positionTreeCard(anchor, { width: innerWidth, height: innerHeight, right }, surface.current?.getBoundingClientRect().height || undefined, expanded ? 900 : card?.id && tree.live[card.id]?.turns.some((turn) => turn.content?.some((part) => part.type === "native")) ? 680 : 420);
      if (expanded) { next.top = 12; next.maxHeight = innerHeight - 24; }
      setPosition((previous) => Object.keys(next).every((key) => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    }
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (surface.current) observer?.observe(surface.current);
    const panel = (surface.current?.getRootNode() as ShadowRoot | undefined)?.querySelector(".panel");
    if (panel) observer?.observe(panel);
    const layoutObserver = new MutationObserver(place);
    layoutObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-lattice-layout"] });
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { observer?.disconnect(); layoutObserver.disconnect(); document.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [tree.focusTarget, cardId, rootId, sourceMessageId, snapshot.answers, hidden, expanded, card?.id, tree.live]);
  useLayoutEffect(() => { if (cardId && !hidden) surface.current?.focus({ preventScroll: true }); }, [tree.focusTarget, cardId, hidden]);

  useEffect(() => {
    if (!cardId) return;
    const outside = (event: Event) => { if (surface.current && !event.composedPath().includes(surface.current)) actions.current.dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); actions.current.dismiss(); } else if (["PageDown", "PageUp", "Home", "End"].includes(event.key) && !event.composedPath().includes(surface.current!)) actions.current.dismiss(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("wheel", outside, { capture: true, passive: true });
    document.addEventListener("touchstart", outside, { capture: true, passive: true });
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside, true); document.removeEventListener("wheel", outside, true); document.removeEventListener("touchstart", outside, true); window.removeEventListener("keydown", key, true); };
  }, [cardId]);

  return <><style>{treeStyles}</style>{card && !hidden && <section ref={surface} className="floating-tree" data-lattice-tree-host="" role="dialog" aria-modal="false" aria-label={`悬浮支线：${card.label}`} tabIndex={-1} style={position}><ThreadCard key={card.id} card={card} tree={tree} pageUrl={snapshot.url} expanded={expanded} expand={() => setExpanded(!expanded)} /></section>}</>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BrainCircuit, Check, CheckCheck, ChevronRight, Copy, GitBranch, LayoutList, Maximize2, MessageSquare, Minimize2, Network, PanelRightClose, Pencil, Quote, Search, Star, Trash2, X } from "lucide-react";
import { LatticeLogo } from "../../src/components/LatticeLogo";
import { positionFloatingToolbar } from "../../src/lib/floating";
import { BranchMap } from "./BranchMap";
import { MindMap } from "./MindMap";
import { DataControls } from "./DataControls";
import { linkExcerptHighlights } from "./highlights";
import { collectChat, decorateAnswers, excerptRange, getAnswerSelection, jumpToAnswer, observeChat } from "./host";
import { InlineConversationTree, TreeOutline } from "./ConversationTree";
import { useConversationTree } from "./useConversationTree";
import { platform, request } from "./platform";
import { BRANCHES_KEY, emptyPresentation, mutatePresentation, presentationKey, readPresentation } from "./presentation";
import type { BranchLink, Excerpt, NativeAnswer, PresentationMutation } from "./types";

type View = "answers" | "branches" | "excerpts" | "mindmap";
const liveHref = () => location.href;

export function LatticeApp({ getHref = liveHref }: { getHref?: () => string }) {
  const [snapshot, setSnapshot] = useState(() => collectChat(document, getHref()));
  const tree = useConversationTree(snapshot);
  const [presentation, setPresentation] = useState(emptyPresentation);
  const [links, setLinks] = useState<BranchLink[]>([]);
  const [open, setOpen] = useState(true);
  const workspaceVisible = open && !snapshot.nativeOverlay;
  const [wide, setWide] = useState(false);
  const [view, setView] = useState<View>("answers");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<(NonNullable<ReturnType<typeof getAnswerSelection>> & { route: string }) | null>(null);
  const [linkedExcerpt, setLinkedExcerpt] = useState<{ id: string; anchor: { left: number; right: number; top: number; bottom: number } } | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [branching, setBranching] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);
  const [loadedRoute, setLoadedRoute] = useState("");
  const currentRoute = useRef(snapshot.route);
  const followedAnchor = useRef("");
  const launcher = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => observeChat(setSnapshot, getHref), [getHref]);
  useEffect(() => { currentRoute.current = snapshot.route; }, [snapshot.route]);
  useEffect(() => {
    const href = getHref();
    if (href === followedAnchor.current) return;
    const hash = new URL(href).hash;
    if (!hash.startsWith("#lattice-message=")) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice("#lattice-message=".length)); } catch { return; }
    const answer = snapshot.answers.find((item) => item.id === id);
    if (!answer) return;
    followedAnchor.current = href;
    const frame = requestAnimationFrame(() => { setActiveId(answer.id); jumpToAnswer(answer); });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.answers, getHref]);
  useEffect(() => decorateAnswers(snapshot.answers, workspaceVisible && presentation.cardView, activeId), [snapshot.answers, presentation.cardView, activeId, workspaceVisible]);
  useEffect(() => {
    if (!workspaceVisible) return;
    return linkExcerptHighlights(snapshot.answers, presentation.excerpts, (excerpt, anchor) => setLinkedExcerpt({ id: excerpt.id, anchor }));
  }, [snapshot.answers, presentation.excerpts, workspaceVisible]);
  useEffect(() => {
    document.documentElement.dataset.latticeOpen = String(workspaceVisible);
    return () => { document.documentElement.removeAttribute("data-lattice-open"); };
  }, [workspaceVisible]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    let loadVersion = 0;
    const key = snapshot.conversationKey ? presentationKey(snapshot.conversationKey) : null;
    async function load() {
      const version = ++loadVersion;
      try {
        const values = await platform().storage.local.get(key ? [key, BRANCHES_KEY] : [BRANCHES_KEY]);
        if (cancelled || version !== loadVersion) return;
        setPresentation(readPresentation(key ? values[key] : undefined));
        setLinks(Array.isArray(values[BRANCHES_KEY]) ? values[BRANCHES_KEY] as BranchLink[] : []);
        setLoadedRoute(snapshot.route);
        setError("");
      } catch { if (!cancelled) setError("无法读取扩展的本地存储。请刷新页面重试。"); }
    }
    void load();
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && ((key && key in changes) || BRANCHES_KEY in changes)) void load();
    };
    platform().storage.onChanged.addListener(changed);
    return () => { cancelled = true; platform().storage.onChanged.removeListener(changed); };
  }, [snapshot.conversationKey, snapshot.route]);

  useEffect(() => {
    if (!snapshot.conversationKey || !snapshot.answers.length) return;
    void request({ type: "conversation:ready", key: snapshot.conversationKey, url: snapshot.url, title: snapshot.title }).catch((cause: unknown) => setError(errorText(cause)));
  }, [snapshot.conversationKey, snapshot.url, snapshot.title, snapshot.answers.length]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() { clearTimeout(timer); timer = setTimeout(() => { const current = getAnswerSelection(snapshot.answers); setSelection(current ? { ...current, route: snapshot.route } : null); }, 100); }
    document.addEventListener("selectionchange", update);
    return () => { document.removeEventListener("selectionchange", update); clearTimeout(timer); };
  }, [snapshot.answers, snapshot.route]);

  const mutate = useCallback(async (mutation: PresentationMutation) => {
    if (loadedRoute !== snapshot.route) return false;
    try {
      if (!snapshot.conversationKey) {
        setPresentation((state) => mutatePresentation(state, mutation));
      } else {
        const response = await request({ type: "presentation:mutate", key: snapshot.conversationKey, pageUrl: snapshot.url, mutation });
        if (snapshot.route === currentRoute.current && response.presentation) setPresentation(response.presentation);
      }
      setError("");
      return true;
    } catch (cause) { setError(errorText(cause)); return false; }
  }, [loadedRoute, snapshot.route, snapshot.conversationKey, snapshot.url]);

  function selectAnswer(answer: NativeAnswer) { setActiveId(answer.id); setWide(false); jumpToAnswer(answer); }

  async function branch(answer: NativeAnswer, excerpt?: Excerpt) {
    if (branching || !snapshot.conversationKey || !answer.stableId) return;
    setBranching(true);
    setSelection(null);
    try {
      const id = await tree.create(answer, excerpt);
      if (id) { window.getSelection()?.removeAllRanges(); jumpToAnswer(answer); setToast("支线卡片已在原回答下展开。首次发送时创建原生分支。"); }
    } finally { setBranching(false); }
  }

  async function saveSelection() {
    if (!selection || !selection.answer.stableId || selection.route !== snapshot.route) return;
    const saved = await mutate({ type: "excerpt:add", excerpt: { id: crypto.randomUUID(), messageId: selection.answer.id, text: selection.text, startOffset: selection.renderedStartOffset, endOffset: selection.renderedEndOffset, note: "", createdAt: new Date().toISOString() } });
    if (!saved) return;
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setView("excerpts");
  }

  async function branchSelection() {
    if (!selection || !selection.answer.stableId || selection.route !== snapshot.route) return;
    const excerpt: Excerpt = { id: crypto.randomUUID(), messageId: selection.answer.id, text: selection.text, startOffset: selection.renderedStartOffset, endOffset: selection.renderedEndOffset, note: "", createdAt: new Date().toISOString() };
    await branch(selection.answer, excerpt);
  }

  function locateExcerpt(excerpt: Excerpt) {
    const answer = snapshot.answers.find((item) => item.id === excerpt.messageId);
    if (!answer) { setToast("来源回答不在当前页面。它可能尚未加载，或已被编辑、删除。"); return; }
    setActiveId(answer.id);
    setWide(false);
    const range = excerptRange(answer, excerpt);
    if (!range) { jumpToAnswer(answer); setToast("原文已变化，已定位到来源回答，请核对摘录。"); return; }
    range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    if (typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.set("lattice-excerpt", new Highlight(range));
  }

  async function addConcept(excerpt: Excerpt) {
    if (!await mutate({ type: "mind:add", node: { id: crypto.randomUUID(), label: excerpt.text.slice(0, 36), excerptId: excerpt.id, messageId: excerpt.messageId, x: (presentation.mindNodes.length % 2) * 210, y: Math.floor(presentation.mindNodes.length / 2) * 120 } })) return;
    setView("mindmap");
  }

  function locateConcept(messageId: string, excerptId: string) {
    const excerpt = presentation.excerpts.find((item) => item.id === excerptId);
    if (excerpt) locateExcerpt(excerpt);
    else {
      const answer = snapshot.answers.find((item) => item.id === messageId);
      if (answer) selectAnswer(answer);
      else setToast("来源回答不在当前页面，请回到原会话核对。");
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setToast("已复制，可粘贴到 ChatGPT 原生输入框继续提问。"); }
    catch { setError("复制失败，请直接选中摘录文字复制。"); }
  }

  const answers = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return snapshot.answers.map((answer, index) => ({ answer, index })).filter(({ answer }) => !search || `${presentation.titles[answer.id] ?? ""} ${answer.question} ${answer.text}`.toLocaleLowerCase().includes(search)).sort((a, b) => Number(presentation.favorites.includes(b.answer.id)) - Number(presentation.favorites.includes(a.answer.id)) || a.index - b.index);
  }, [snapshot.answers, query, presentation.titles, presentation.favorites]);
  const ready = loadedRoute === snapshot.route;
  const previewExcerpt = presentation.excerpts.find((excerpt) => excerpt.id === linkedExcerpt?.id);
  const previewPosition = linkedExcerpt ? positionFloatingToolbar(linkedExcerpt.anchor, { width: innerWidth, height: innerHeight }, { width: 300, height: 280 }) : null;
  const incomingBranch = links.find((link) => link.targetKey === snapshot.conversationKey);
  const floating = selection?.route === snapshot.route ? positionFloatingToolbar(selection.anchor, { width: innerWidth, height: innerHeight }, { width: 252, height: 44 }) : null;
  if (floating && selection && selection.anchor.bottom + 52 < innerHeight) floating.top = selection.anchor.bottom + 8;

  return <div className="lattice">
    <InlineConversationTree snapshot={snapshot} tree={tree} hidden={!!snapshot.nativeOverlay} />
    {!snapshot.nativeOverlay && <button className={`launcher ${open ? "is-open" : ""}`} ref={launcher} onClick={() => { setOpen(!open); if (!open) setTimeout(() => searchInput.current?.focus(), 0); }} aria-label={open ? "收起 Lattice" : "打开 Lattice"} aria-expanded={open} type="button"><LatticeLogo /><span>Lattice</span><ChevronRight size={14} /></button>}
    {open && <aside className={`panel ${wide ? "wide" : ""}`} style={{ display: workspaceVisible ? undefined : "none" }} aria-label="Lattice 对话工作区" onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); launcher.current?.focus(); } }}>
      <header className="panel-header"><div className="brand"><LatticeLogo /><strong>Lattice</strong><span>for ChatGPT</span></div><div><button className="icon-button" aria-label={wide ? "收窄工作区" : "展开工作区"} onClick={() => setWide(!wide)}>{wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button><button className="icon-button" onClick={() => { setOpen(false); launcher.current?.focus(); }} title="收起工作区" aria-label="收起工作区"><PanelRightClose size={17} /></button></div></header>
      <div className="conversation-heading"><span className="connection"><CheckCheck size={13} />ChatGPT 原生对话</span><h1 title={snapshot.title}>{snapshot.title === "ChatGPT" ? snapshot.answers[0]?.question || "从一个问题开始" : snapshot.title}</h1><p>{snapshot.answers.length} 条回答<span>·</span>问答、引用与工具由 ChatGPT 处理</p></div>
      <nav className="tabs" aria-label="工作区视图">{([{ id: "answers", label: "对话树", Icon: LayoutList }, { id: "branches", label: "分支", Icon: Network }, { id: "excerpts", label: "摘录", Icon: Quote }, { id: "mindmap", label: "思维图", Icon: BrainCircuit }] as const).map(({ id, label, Icon }) => <button key={id} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}><Icon size={15} />{label}{id === "excerpts" && presentation.excerpts.length > 0 && <span>{presentation.excerpts.length}</span>}</button>)}</nav>
      {(error || tree.error) && <div className="error" role="alert">{error || tree.error}<button className="icon-button" aria-label="关闭错误提示" onClick={() => { setError(""); tree.clearError(); }}><X size={14} /></button></div>}
      {!snapshot.conversationKey && <p className="session-notice">此页面尚无已保存的会话地址，整理仅保留在当前页面。</p>}
      <div className="panel-body">
        {incomingBranch?.excerpt && <section className="branch-context"><span><GitBranch size={13} />这条分支的探索线索</span><blockquote>{incomingBranch.excerpt.text}</blockquote><div className="card-footer"><a href={incomingBranch.sourceUrl}>返回分支起点<ArrowUpRight size={12} /></a><button className="text-button" onClick={() => void copy(incomingBranch.excerpt!.text)}>复制摘录<Copy size={12} /></button></div></section>}
        {view === "answers" && <>
          <p className="tree-intro">主线保持连续。选中回答中的名词，就地展开可收起、可继续追问的支线。</p>
          <div className="answer-tools"><label className="search"><Search size={15} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找问题与回答" aria-label="查找问题与回答" />{query && <button aria-label="清除搜索" onClick={() => setQuery("")}><X size={13} /></button>}</label><button className={`view-toggle ${presentation.cardView ? "enabled" : ""}`} aria-pressed={presentation.cardView} title="切换原文的卡片排版" disabled={!ready} onClick={() => void mutate({ type: "cardView", enabled: !presentation.cardView })}><LayoutList size={15} /></button></div>
          <div className="answer-list">{!answers.length ? <div className="empty-state"><MessageSquare size={28} /><h2>{query ? "没有匹配的回答" : "让对话在这里展开"}</h2><p>{query ? "试试问题中的另一个关键词。" : "在 ChatGPT 中正常提问。回答出现后，这里会自动生成导航卡片。"}</p></div> : answers.map(({ answer, index }) => <article key={answer.id} className={`answer-card ${activeId === answer.id ? "active" : ""}`}>
            <div className="card-meta"><span>回答 {String(index + 1).padStart(2, "0")}</span><div><button className={`icon-button ${presentation.favorites.includes(answer.id) ? "starred" : ""}`} aria-label={`${presentation.favorites.includes(answer.id) ? "取消置顶" : "置顶"}回答 ${index + 1}`} disabled={!ready || !answer.stableId} onClick={() => void mutate({ type: "favorite", messageId: answer.id, favorite: !presentation.favorites.includes(answer.id) })}><Star size={14} fill={presentation.favorites.includes(answer.id) ? "currentColor" : "none"} /></button><button className="icon-button" aria-label={`重命名回答 ${index + 1} 的卡片`} disabled={!ready || !answer.stableId} onClick={() => setEditing(answer.id)}><Pencil size={13} /></button></div></div>
            {editing === answer.id ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate({ type: "title", messageId: answer.id, title: String(form.get("title") ?? "") }); setEditing(null); }}><input name="title" aria-label="卡片标题" defaultValue={presentation.titles[answer.id] || answer.question} maxLength={160} autoFocus /><button className="icon-button" aria-label="保存卡片标题"><Check size={15} /></button><button className="icon-button" type="button" aria-label="取消重命名" onClick={() => setEditing(null)}><X size={15} /></button></form> : <button className="answer-link" onClick={() => selectAnswer(answer)}><h2>{presentation.titles[answer.id] || answer.question || `回答 ${index + 1}`}</h2><p>{answer.text.slice(0, 170) || "ChatGPT 正在生成回答…"}</p></button>}
            <div className="card-footer"><button className="text-button" onClick={() => selectAnswer(answer)}>定位原文<ArrowUpRight size={13} /></button><button className="branch-button" disabled={branching || !snapshot.conversationKey || !answer.stableId} onClick={() => void branch(answer)} title="在原回答下展开可连续追问的支线，首次发送时创建原生分支"><GitBranch size={13} />就地追问</button></div>
            <TreeOutline tree={tree} messageId={answer.id} />
            {!answer.stableId && <p className="card-notice">此回答缺少稳定标识，暂时仅支持定位。</p>}
          </article>)}</div>
          {snapshot.answers.length > 0 && <p className="tip">选中原文里的专业名词，展开支线追问；也可以保存摘录。</p>}
        </>}
        {view === "branches" && <BranchMap snapshot={snapshot} links={links} />}
        {view === "mindmap" && <MindMap presentation={presentation} mutate={mutate} locate={locateConcept} />}
        {view === "excerpts" && <div className="excerpts-view"><div className="section-intro"><Quote size={20} /><h2>留住值得继续的片段</h2><p>摘录和笔记保存在这个浏览器中。点击原文里的蓝色高亮，可再次打开关联卡片。</p></div>{!presentation.excerpts.length ? <div className="empty-state"><Quote size={28} /><p>在 ChatGPT 的回答中选中文字，点击“摘录成卡片”。</p></div> : presentation.excerpts.map((excerpt) => <article className="excerpt-card" key={excerpt.id}><blockquote>{excerpt.text}</blockquote><textarea key={`${excerpt.id}:${excerpt.note}`} aria-label="摘录笔记" placeholder="写下你的想法…" defaultValue={excerpt.note} rows={2} onBlur={(event) => { if (event.target.value !== excerpt.note) void mutate({ type: "excerpt:add", excerpt: { ...excerpt, note: event.target.value } }); }} /><button className="concept-button" disabled={!ready} onClick={() => void addConcept(excerpt)}><BrainCircuit size={13} />{presentation.mindNodes.some((node) => node.excerptId === excerpt.id) ? "查看思维图" : "加入思维图"}</button><div className="card-footer"><button className="text-button" onClick={() => locateExcerpt(excerpt)}>回到原文<ArrowUpRight size={13} /></button><div><button className="icon-button" aria-label="复制摘录" onClick={() => void copy(excerpt.text)}><Copy size={14} /></button><button className="icon-button" disabled={!ready} aria-label="删除本地摘录" onClick={() => void mutate({ type: "excerpt:remove", id: excerpt.id })}><Trash2 size={14} /></button></div></div></article>)}</div>}
      </div>
      <footer className="panel-footer">{clearPending ? <div className="clear-confirm"><span>清空本会话的本地对话树、摘录与思维图？原生会话保留。</span><button onClick={() => { void mutate({ type: "clear" }); setClearPending(false); }}>清空</button><button onClick={() => setClearPending(false)}>取消</button></div> : <><span>整理保存在本机</span><div className="footer-actions"><DataControls key={snapshot.route} snapshot={snapshot} presentation={presentation} links={links} cards={tree.cards} mutate={mutate} report={setToast} ready={ready} /><button disabled={!ready} onClick={() => setClearPending(true)}>清空整理</button></div></>}</footer>
    </aside>}
    {!snapshot.nativeOverlay && selection && floating && <div className="selection-toolbar" style={floating} role="toolbar" aria-label="选区操作"><button disabled={!selection.answer.stableId || !ready} onPointerDown={(event) => event.preventDefault()} onClick={() => void saveSelection()}><Quote size={14} />摘录成卡片</button><button disabled={branching || !selection.answer.stableId || !snapshot.conversationKey} onPointerDown={(event) => event.preventDefault()} onClick={() => void branchSelection()}><GitBranch size={14} />支线追问</button></div>}
    {workspaceVisible && !selection && previewExcerpt && previewPosition && <section className="linked-preview" style={previewPosition} aria-label="关联摘录卡片"><header><span><Quote size={14} />关联摘录</span><button className="icon-button" aria-label="关闭关联卡片" onClick={() => setLinkedExcerpt(null)}><X size={14} /></button></header><blockquote>{previewExcerpt.text}</blockquote>{previewExcerpt.note && <p>{previewExcerpt.note}</p>}<div className="card-footer"><button className="text-button" onClick={() => { setView("excerpts"); setLinkedExcerpt(null); }}>打开摘录<ArrowUpRight size={13} /></button><button className="branch-button" disabled={branching || !snapshot.conversationKey} onClick={() => { const answer = snapshot.answers.find((item) => item.id === previewExcerpt.messageId); if (answer) void branch(answer, previewExcerpt); setLinkedExcerpt(null); }}><GitBranch size={13} />展开支线</button></div></section>}
    {toast && !snapshot.nativeOverlay && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : "操作失败，请刷新后重试。"; }

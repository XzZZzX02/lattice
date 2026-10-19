import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { platform, request } from "./platform";
import { answerReference } from "./tree-reference";
import type { ChatSnapshot, Excerpt, NativeAnswer } from "./types";
import { TREE_KEY, type TreeCard, type TreeLive, type TreeMessage } from "./tree-types";

export function useConversationTree(snapshot: ChatSnapshot) {
  const [cards, setCards] = useState<TreeCard[]>([]);
  const [live, setLive] = useState<Record<string, TreeLive>>({});
  const [error, setError] = useState("");
  const [focusTarget, setFocusTarget] = useState<{ id: string; route: string } | null>(null);
  if (focusTarget && focusTarget.route !== snapshot.route) setFocusTarget(null);
  const current = useRef(snapshot);
  useLayoutEffect(() => { current.current = snapshot; }, [snapshot]);
  const refresh = useCallback(async () => {
    const source = current.current;
    if (!source.conversationKey) { setCards([]); setLive({}); return; }
    const result = await request({ type: "tree:read", rootKey: source.conversationKey, pageUrl: source.url });
    if (current.current.route !== source.route) return;
    const nextCards = result.cards ?? [];
    const nextLive = result.live ?? {};
    setCards((previous) => JSON.stringify(previous) === JSON.stringify(nextCards) ? previous : nextCards);
    setLive((previous) => JSON.stringify(previous) === JSON.stringify(nextLive) ? previous : nextLive);
  }, []);
  useEffect(() => {
    let stopped = false;
    const load = () => { if (!stopped) void refresh().catch(() => undefined); };
    load();
    const timer = setInterval(load, 1400);
    const changed = (changes: Record<string, unknown>, area: string) => { if (area === "local" && TREE_KEY in changes) load(); };
    platform().storage.onChanged.addListener(changed);
    return () => { stopped = true; clearInterval(timer); platform().storage.onChanged.removeListener(changed); };
  }, [snapshot.route, refresh]);
  async function act(message: TreeMessage) {
    try { const result = await request(message); setError(""); await refresh(); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "支线操作失败，请重试。"); return null; }
  }
  function root() { return { rootKey: snapshot.conversationKey!, pageUrl: snapshot.url }; }
  async function create(answer: Pick<NativeAnswer, "id" | "stableId"> & Partial<Pick<NativeAnswer, "contentElement">>, anchor?: Excerpt, parent?: TreeCard) {
    if (!snapshot.conversationKey || !answer.stableId) { setError("请等原生会话保存完成后，再从稳定的回答创建支线。"); return; }
    const reference = anchor ?? (answer.contentElement ? answerReference(answer.id, answer.contentElement) : undefined);
    const result = await act({ type: "tree:create", ...root(), sourceKey: parent?.targetKey || snapshot.conversationKey, sourceUrl: parent?.targetUrl || snapshot.url, messageId: answer.id, label: anchor?.text.slice(0, 80) || "关于这条回答", ...(reference ? { anchor: reference } : {}), ...(parent ? { parentId: parent.id } : {}) });
    if (result?.cardId && current.current.route === snapshot.route) setFocusTarget({ id: result.cardId, route: snapshot.route });
    return result?.cardId;
  }
  async function update(id: string, patch: { collapsed?: boolean; draft?: string }) {
    return act({ type: "tree:update", ...root(), id, ...patch });
  }
  async function send(card: TreeCard, text: string) { return act({ type: "tree:send", ...root(), id: card.id, text }); }
  async function focus(card: TreeCard) {
    setFocusTarget({ id: card.id, route: snapshot.route });
    await update(card.id, { collapsed: false });
    if (card.targetKey) await act({ type: "tree:resume", ...root(), id: card.id });
  }
  function dismiss() {
    const card = cards.find((item) => item.id === focusTarget?.id);
    setFocusTarget(null);
    if (card) void update(card.id, { collapsed: true });
  }
  return { cards: cards.filter((card) => card.rootKey === snapshot.conversationKey), live, error, clearError: () => setError(""), focusTarget, dismiss, create, update, send, focus, open: (card: TreeCard) => act({ type: "tree:open", ...root(), id: card.id }), resume: (card: TreeCard) => act({ type: "tree:resume", ...root(), id: card.id }) };
}

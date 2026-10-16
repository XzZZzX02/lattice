import type { ExtensionPlatform, Tab } from "./platform";
import type { BranchLink, ExtensionResponse } from "./types";
import { BRANCHES_KEY, conversationKey } from "./presentation";
import { TREE_KEY, WORKERS_KEY, type NativeCommand, type NativeReport, type TreeCard, type TreeLive, type TreeMessage } from "./tree-types";

interface Worker {
  cardId: string;
  tabId: number;
  ownerTabId: number;
  sourceTabId?: number;
  live: TreeLive;
  command?: NativeCommand;
  delivered?: boolean;
  lastKey?: string | null;
}
const busy = (worker?: Worker) => worker && ["preparing", "forking", "loading", "sending", "waiting"].includes(worker.live.phase);

export function createTreeCoordinator(api: ExtensionPlatform) {
  async function cards(): Promise<TreeCard[]> { return (await api.storage.local.get(TREE_KEY))[TREE_KEY] as TreeCard[] ?? []; }
  async function workers(): Promise<Worker[]> { return (await api.storage.session.get(WORKERS_KEY))[WORKERS_KEY] as Worker[] ?? []; }
  async function saveWorkers(value: Worker[]) { await api.storage.session.set({ [WORKERS_KEY]: value }); }
  async function start(card: TreeCard, ownerTabId: number, text?: string) {
    if (!api.tabs.create) throw new Error("此浏览器暂不支持原生支线标签页。");
    const all = await workers();
    const previous = all.find((worker) => worker.cardId === card.id);
    if (busy(previous)) throw new Error("这条支线正在处理上一条问题，请稍候。若原生页面需要操作，请打开原生分支。");
    if (previous && card.targetKey && previous.lastKey === card.targetKey && await api.tabs.get?.(previous.tabId).catch(() => null)) {
      previous.live = { phase: "loading", turns: previous.live.turns, ...(text ? { pending: text } : {}), updatedAt: Date.now() };
      previous.command = undefined;
      previous.delivered = false;
      await saveWorkers(all);
      return;
    }
    // Every operation starts in a dedicated extension-created tab. Never navigate
    // an arbitrary existing tab or a user's main conversation.
    const url = new URL(card.targetUrl || card.sourceUrl);
    url.hash = `lattice-worker=${card.id}`;
    const tab = await api.tabs.create({ url: url.href, active: false });
    if (tab.id === undefined) throw new Error("无法打开 ChatGPT 原生分支。");
    const worker: Worker = { cardId: card.id, tabId: tab.id, ownerTabId, live: { phase: card.targetKey ? "loading" : "preparing", turns: previous?.live.turns ?? [], ...(text ? { pending: text } : {}), updatedAt: Date.now() } };
    await saveWorkers([...all.filter((item) => item.cardId !== card.id), worker]);
    await api.tabs.update?.(tab.id, { autoDiscardable: false }).catch(() => undefined);
  }
  async function report(worker: Worker, report: NativeReport, all: Worker[], records: TreeCard[]): Promise<ExtensionResponse> {
    const card = records.find((item) => item.id === worker.cardId);
    if (!card) return { ok: true, managed: false };
    if (conversationKey(report.url) !== report.key) return { ok: false, error: "原生分支地址尚未稳定。" };
    worker.lastKey = report.key;
    const now = Date.now();
    if (worker.live.phase === "preparing" && report.key === card.sourceKey && report.composerReady) {
      const index = report.answers.findIndex((answer) => answer.id === card.sourceMessageId);
      if (index >= 0 && !report.generating) {
        card.inheritedTurns = index + 1;
        worker.command = { id: crypto.randomUUID(), type: "fork", key: card.sourceKey, messageId: card.sourceMessageId };
        worker.delivered = false;
        worker.live.phase = "forking";
        await api.storage.local.set({ [TREE_KEY]: records });
      }
    } else if (!card.targetKey && ["forking", "sending", "waiting"].includes(worker.live.phase) && report.key && report.key !== card.sourceKey && report.answers.length && report.composerReady) {
      card.targetKey = report.key;
      card.targetUrl = new URL(report.url).origin + new URL(report.url).pathname;
      if (worker.live.phase === "forking") { worker.command = undefined; worker.live.phase = "loading"; }
      const existing = (await api.storage.local.get(BRANCHES_KEY))[BRANCHES_KEY] as BranchLink[] ?? [];
      const source = new URL(card.sourceUrl);
      source.hash = `lattice-message=${encodeURIComponent(card.sourceMessageId)}`;
      const link: BranchLink = { sourceKey: card.sourceKey, sourceUrl: source.href, sourceMessageId: card.sourceMessageId, sourceTitle: card.label, targetKey: report.key, targetUrl: card.targetUrl, targetTitle: report.title, createdAt: new Date().toISOString(), ...(card.anchor ? { excerpt: card.anchor } : {}) };
      await api.storage.local.set({ [TREE_KEY]: records, [BRANCHES_KEY]: [...existing.filter((item) => item.targetKey !== card.targetKey), link] });
    }
    // ChatGPT can create a local native fork whose saved conversation ID only
    // appears after the first send. Bind that single send to the exact local
    // route; persist the real URL when ChatGPT supplies it. Never fabricate IDs.
    if (worker.live.phase === "forking" && !report.key && /^\/c\/local-chatgpt(?:%3A|:)/i.test(new URL(report.url).pathname) && report.answers.length && report.composerReady && !report.generating && worker.live.pending) {
      worker.command = { id: crypto.randomUUID(), type: "send", key: "", route: report.url, text: worker.live.pending };
      worker.delivered = false;
      worker.live.phase = "sending";
    }
    if (card.targetKey && report.key === card.targetKey) {
      worker.live.turns = report.answers.slice(card.inheritedTurns ?? 0);
      if (worker.live.phase === "loading" && report.composerReady && !report.generating) {
        if (worker.live.pending) {
          worker.command = { id: crypto.randomUUID(), type: "send", key: card.targetKey, text: worker.live.pending };
          worker.delivered = false;
          worker.live.phase = "sending";
        } else worker.live.phase = "ready";
      }
      // Native rich text can drop paragraph separators when projecting a prompt.
      const normalized = (value: string) => value.replace(/\s+/g, "");
      if (worker.live.phase === "waiting" && worker.live.turns.some((turn) => normalized(turn.question) === normalized(worker.live.pending ?? "")) && !report.generating && worker.live.turns.at(-1)?.text.trim()) {
        worker.live.phase = "ready";
        worker.live.pending = undefined;
      }
    }
    if (now - worker.live.updatedAt > 120_000 && busy(worker) && !report.generating) {
      worker.live.phase = "error";
      worker.live.error = "原生页面尚未完成操作。请打开原生分支检查登录、确认窗口或生成状态；系统不会自动重复发送。";
    }
    const command = !worker.delivered ? worker.command : undefined;
    if (command) worker.delivered = true; // At-most-once delivery: never replay a send after reload.
    await saveWorkers(all);
    return { ok: true, managed: true, ...(command ? { command } : {}) };
  }
  return {
    async replace(rootKey: string, restored: TreeCard[]) {
      const existing = await cards();
      const removed = new Set(existing.filter((card) => card.rootKey === rootKey).map((card) => card.id));
      const retained = existing.filter((card) => card.rootKey !== rootKey);
      const occupied = new Set(retained.map((card) => card.id));
      const remap = new Map(restored.map((card) => [card.id, occupied.has(card.id) ? crypto.randomUUID() : card.id]));
      // Restoring metadata must never adopt another tree's live worker or replay
      // a command left over from before the restore.
      await saveWorkers((await workers()).filter((worker) => !removed.has(worker.cardId)));
      await api.storage.local.set({ [TREE_KEY]: [...retained, ...restored.map((card) => ({ ...card, id: remap.get(card.id)!, ...(card.parentId ? { parentId: remap.get(card.parentId)! } : {}) }))] });
    },
    async created(tab: Tab) {
      if (tab.id === undefined || tab.openerTabId === undefined) return;
      const all = await workers();
      const parent = all.find((item) => item.tabId === tab.openerTabId && item.live.phase === "forking");
      if (!parent) return;
      parent.sourceTabId = parent.tabId;
      parent.tabId = tab.id;
      await saveWorkers(all);
      if (tab.active) await api.tabs.update?.(parent.ownerTabId, { active: true }).catch(() => undefined);
    },
    async handle(message: TreeMessage, tabId: number): Promise<ExtensionResponse> {
      const all = await workers();
      if (message.type === "native:hello") return { ok: true, managed: all.some((item) => item.tabId === tabId) };
      if (message.type === "native:report" || message.type === "native:ack") {
        const worker = all.find((item) => item.tabId === tabId);
        if (!worker) return { ok: true, managed: false };
        const records = await cards();
        if (message.type === "native:report") return report(worker, message.report, all, records);
        if (worker.command?.id !== message.commandId) return { ok: true };
        if (message.error) { worker.live.phase = "error"; worker.live.error = message.error; }
        else if (worker.command.type === "send") {
          worker.live.phase = "waiting";
          const card = records.find((item) => item.id === worker.cardId);
          if (card) { card.draft = ""; await api.storage.local.set({ [TREE_KEY]: records }); }
        }
        worker.command = undefined;
        worker.live.updatedAt = Date.now();
        await saveWorkers(all);
        return { ok: true };
      }
      if (conversationKey(message.pageUrl) !== message.rootKey) return { ok: false, error: "主线会话已变化，请重新打开支线。" };
      const records = await cards();
      const family = records.filter((item) => item.rootKey === message.rootKey);
      if (message.type === "tree:read") {
        return { ok: true, cards: family, live: Object.fromEntries(all.filter((worker) => family.some((card) => card.id === worker.cardId)).map((worker) => [worker.cardId, worker.live])) };
      }
      if (message.type === "tree:create") {
        const parent = message.parentId ? family.find((item) => item.id === message.parentId) : undefined;
        if ((message.parentId && !parent) || (parent ? parent.targetKey !== message.sourceKey : message.rootKey !== message.sourceKey) || conversationKey(message.sourceUrl) !== message.sourceKey || !/^(message|turn):/.test(message.messageId)) return { ok: false, error: "请从当前主线或已建立的父支线回答创建卡片。" };
        const card: TreeCard = { id: crypto.randomUUID(), rootKey: message.rootKey, ...(parent ? { parentId: parent.id } : {}), sourceKey: message.sourceKey, sourceUrl: message.sourceUrl, sourceMessageId: message.messageId, label: message.label.slice(0, 120) || "新的支线", ...(message.anchor ? { anchor: message.anchor } : {}), collapsed: false, draft: "", createdAt: new Date().toISOString() };
        records.push(card);
        await api.storage.local.set({ [TREE_KEY]: records });
        return { ok: true, cardId: card.id };
      }
      const card = family.find((item) => item.id === message.id);
      if (!card) return { ok: false, error: "找不到这条支线，请重新打开主线。" };
      if (message.type === "tree:update") {
        if (message.collapsed !== undefined) card.collapsed = message.collapsed;
        if (message.draft !== undefined) card.draft = message.draft.slice(0, 20_000);
        if (message.label?.trim()) card.label = message.label.trim().slice(0, 120);
        await api.storage.local.set({ [TREE_KEY]: records });
      } else if (message.type === "tree:send") {
        if (!message.text.trim() || message.text.length > 20_000) return { ok: false, error: "请输入 1 至 20,000 字的问题。" };
        const text = message.text.trim();
        card.draft = text;
        await api.storage.local.set({ [TREE_KEY]: records });
        const prompt = !card.targetKey && card.anchor ? `关于原回答中的「${card.anchor.text}」，我的问题是：\n${text}` : text;
        await start(card, tabId, prompt);
      } else if (message.type === "tree:resume" && card.targetKey) {
        if (!all.some((worker) => worker.cardId === card.id)) await start(card, tabId);
      } else if (message.type === "tree:open") {
        const worker = all.find((item) => item.cardId === card.id);
        if (worker && api.tabs.update) await api.tabs.update(worker.tabId, { active: true });
        else await api.tabs.create?.({ url: card.targetUrl || card.sourceUrl, active: true });
      }
      return { ok: true };
    }
  };
}

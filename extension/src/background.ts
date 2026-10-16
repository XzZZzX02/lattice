import { platform } from "./platform";
import { BRANCHES_KEY, BRANCH_TTL, confirmBranch, conversationKey, mutatePresentation, presentationKey, readPresentation } from "./presentation";
import type { BranchLink, ExtensionMessage, ExtensionResponse, PendingBranch } from "./types";
import { sanitizeBranches } from "./backup";
import { connectedBranches } from "./presentation";
import { createTreeCoordinator } from "./tree-background";
import type { TreeMessage } from "./tree-types";
import { sanitizeTree } from "./tree-storage";

const api = platform();
const tree = createTreeCoordinator(api);
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

api.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  void serialize(async () => {
    await tree.created(tab);
    const key = `lattice:pending:${tab.openerTabId}`;
    const pending = (await api.storage.session.get(key))[key] as PendingBranch | undefined;
    if (pending && Date.now() - pending.createdAt <= BRANCH_TTL) await api.storage.session.set({ [`lattice:opener:${tab.id}`]: tab.openerTabId });
  });
});

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.url || new URL(sender.url).origin !== "https://chatgpt.com" || sender.tab?.id === undefined) return;
  const tabId = sender.tab.id;
  void serialize(() => handleMessage(message, tabId, sender.url!)).then(respond, () => respond({ ok: false, error: "无法保存本地整理，请刷新页面后重试。" }));
  return true;
});

async function handleMessage(message: ExtensionMessage, tabId: number, senderUrl: string): Promise<ExtensionResponse> {
  if (message.type.startsWith("tree:") || message.type.startsWith("native:")) return tree.handle(message as TreeMessage, tabId);
  if (message.type === "branch:link") {
    const targetKey = conversationKey(message.targetUrl);
    if (conversationKey(senderUrl) !== message.sourceKey || conversationKey(message.sourceUrl) !== message.sourceKey || !targetKey || targetKey === message.sourceKey) return { ok: false, error: "请填写另一个 ChatGPT 原生会话的地址。" };
    const target = new URL(message.targetUrl);
    const source = new URL(message.sourceUrl);
    source.hash = `lattice-message=${encodeURIComponent(message.sourceMessageId)}`;
    const link: BranchLink = { sourceKey: message.sourceKey, sourceUrl: source.href, sourceMessageId: message.sourceMessageId, sourceTitle: message.sourceTitle.slice(0, 160), targetKey, targetUrl: target.origin + target.pathname, targetTitle: message.targetTitle.trim().slice(0, 160) || "原生分支", createdAt: new Date().toISOString(), manual: true };
    const existing = sanitizeBranches((await api.storage.local.get(BRANCHES_KEY))[BRANCHES_KEY]);
    // A conversation has one recorded parent; replacing it requires removing or restoring the local record explicitly.
    if (existing.some((item) => item.targetKey === targetKey)) return { ok: false, error: "此会话已有记录的分支起点。" };
    if (connectedBranches(existing, targetKey).some((item) => item.sourceKey === message.sourceKey || item.targetKey === message.sourceKey)) return { ok: false, error: "这两个会话已经位于同一分支树中。" };
    await api.storage.local.set({ [BRANCHES_KEY]: [...existing, link] });
    return { ok: true };
  }
  if (message.type === "presentation:mutate") {
    // Chrome can retain the injection document URL in MessageSender across SPA
    // navigation. Our isolated content script includes its current page URL.
    if (conversationKey(message.pageUrl ?? senderUrl) !== message.key) return { ok: false, error: "会话已切换，请重试。" };
    const key = presentationKey(message.key);
    const saved = await api.storage.local.get(key);
    const presentation = mutatePresentation(readPresentation(saved[key]), message.mutation);
    if (message.mutation.type === "clear") await api.storage.local.remove(key);
    else await api.storage.local.set({ [key]: presentation });
    if (message.mutation.type === "clear" || (message.mutation.type === "restore" && message.mutation.tree)) {
      const restored = message.mutation.type === "restore" ? sanitizeTree(message.mutation.tree, message.key) : [];
      await tree.replace(message.key, restored);
    }
    if (message.mutation.type === "restore" && message.mutation.branches) {
      const restored = connectedBranches(sanitizeBranches(message.mutation.branches), message.key);
      const existing = sanitizeBranches((await api.storage.local.get(BRANCHES_KEY))[BRANCHES_KEY]);
      const targets = new Set(restored.map((link) => link.targetKey));
      await api.storage.local.set({ [BRANCHES_KEY]: [...existing.filter((link) => !targets.has(link.targetKey)), ...restored] });
    }
    return { ok: true, presentation };
  }
  if (message.type === "branch:arm") {
    if (conversationKey(senderUrl) !== message.key || conversationKey(message.url) !== message.key) return { ok: false, error: "请在已保存的原会话中创建分支。" };
    const token = crypto.randomUUID();
    const sourceUrl = new URL(message.url);
    sourceUrl.hash = `lattice-message=${encodeURIComponent(message.messageId)}`;
    const pending: PendingBranch = { token, sourceTabId: tabId, sourceKey: message.key, sourceUrl: sourceUrl.href, sourceMessageId: message.messageId, sourceTitle: message.title.slice(0, 160), createdAt: Date.now(), ...(message.excerpt ? { excerpt: message.excerpt } : {}) };
    await api.storage.session.set({ [`lattice:pending:${tabId}`]: pending });
    return { ok: true, token };
  }
  if (message.type === "branch:cancel") {
    const key = `lattice:pending:${tabId}`;
    const pending = (await api.storage.session.get(key))[key] as PendingBranch | undefined;
    if (pending?.token === message.token) await api.storage.session.remove(key);
    return { ok: true };
  }
  if (message.type === "conversation:ready") {
    if (conversationKey(message.url) !== message.key) return { ok: false, error: "无效的 ChatGPT 会话。" };
    const openerKey = `lattice:opener:${tabId}`;
    const opener = (await api.storage.session.get(openerKey))[openerKey];
    const sources = [...new Set([tabId, ...(typeof opener === "number" ? [opener] : [])])];
    for (const sourceTabId of sources) {
      const pendingKey = `lattice:pending:${sourceTabId}`;
      const pending = (await api.storage.session.get(pendingKey))[pendingKey] as PendingBranch | undefined;
      if (!pending) continue;
      if (Date.now() - pending.createdAt > BRANCH_TTL) {
        await api.storage.session.remove(pendingKey);
        continue;
      }
      const link = confirmBranch(pending, message.url, message.title);
      if (!link) continue;
      const links = (await api.storage.local.get(BRANCHES_KEY))[BRANCHES_KEY] as BranchLink[] | undefined;
      await api.storage.local.set({ [BRANCHES_KEY]: [...(links ?? []).filter((item) => item.targetKey !== link.targetKey), link] });
      await api.storage.session.remove([pendingKey, openerKey]);
      break;
    }
    return { ok: true };
  }
  return { ok: false, error: "不支持的扩展操作。" };
}

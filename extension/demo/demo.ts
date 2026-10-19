import { mountLattice } from "../src/mount";
import { BRANCHES_KEY, confirmBranch, mutatePresentation, presentationKey, readPresentation } from "../src/presentation";
import type { ExtensionPlatform, StorageArea } from "../src/platform";
import type { BranchLink, ExtensionMessage, PendingBranch } from "../src/types";
import nativeStyles from "../public/native.css?inline";
import { createTreeCoordinator } from "../src/tree-background";
import { createDemoLab } from "./native-lab";
import { createSurfaceBridge } from "../src/native-surface";
import { collectChat } from "../src/host";
import { projectMarkdown } from "../src/native-relay";
import type { NativeReport, TreeMessage } from "../src/tree-types";

history.replaceState(null, "", "/c/demo-main");
const style = document.createElement("style");
style.textContent = nativeStyles;
document.head.append(style);
const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
const data: Record<string, unknown> = JSON.parse(sessionStorage.getItem("lattice-demo") || "{}");
const storage: StorageArea = {
  get: async (keys) => Object.fromEntries((keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : keys).map((key) => [key, data[key]])),
  set: async (items) => { Object.assign(data, items); sessionStorage.setItem("lattice-demo", JSON.stringify(data)); for (const listener of listeners) listener(Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }])), "local"); },
  remove: async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; sessionStorage.setItem("lattice-demo", JSON.stringify(data)); }
};
let pending: PendingBranch | null = null;
const virtualTabs = new Map<number, NativeReport>();
const virtualHistory = new Map<string, NativeReport>(JSON.parse(sessionStorage.getItem("lattice-demo-native-history") || "[]"));
const surfaces = new Map<number, Map<string, HTMLElement>>();
const bridges = new Map<number, ReturnType<typeof createSurfaceBridge>>();
let nextTab = 10;
const api: ExtensionPlatform = {
  storage: { local: storage, session: storage, onChanged: { addListener: (listener) => { listeners.add(listener); }, removeListener: (listener) => { listeners.delete(listener); } } },
  runtime: {
    onMessage: { addListener() {} },
    sendMessage: async (message: ExtensionMessage) => {
      if (message.type.startsWith("tree:")) return treeCoordinator.handle(message as TreeMessage, 1);
      if (message.type === "presentation:mutate") {
        const key = presentationKey(message.key);
        const presentation = mutatePresentation(readPresentation(data[key]), message.mutation);
        await storage.set({ [key]: presentation });
        if (message.mutation.type === "clear" || (message.mutation.type === "restore" && message.mutation.tree)) await treeCoordinator.replace(message.key, message.mutation.type === "restore" ? message.mutation.tree! : []);
        return { ok: true, presentation };
      }
      if (message.type === "branch:arm") {
        const token = crypto.randomUUID();
        pending = { token, sourceTabId: 1, sourceKey: message.key, sourceUrl: `${message.url}#lattice-message=${encodeURIComponent(message.messageId)}`, sourceMessageId: message.messageId, sourceTitle: message.title, createdAt: Date.now(), ...(message.excerpt ? { excerpt: message.excerpt } : {}) };
        return { ok: true, token };
      }
      if (message.type === "conversation:ready" && pending) {
        const link = confirmBranch(pending, message.url, message.title);
        if (link) { await storage.set({ [BRANCHES_KEY]: [...(data[BRANCHES_KEY] as BranchLink[] ?? []), link] }); pending = null; }
      }
      if (message.type === "branch:link") {
        const targetKey = message.targetUrl.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1];
        if (!targetKey || !message.targetUrl.startsWith("https://chatgpt.com/")) return { ok: false, error: "请填写 ChatGPT 会话地址。" };
        const link: BranchLink = { ...message, sourceUrl: `${message.sourceUrl}#lattice-message=${encodeURIComponent(message.sourceMessageId)}`, targetKey: `chatgpt:${targetKey}`, createdAt: new Date().toISOString(), manual: true };
        await storage.set({ [BRANCHES_KEY]: [...(data[BRANCHES_KEY] as BranchLink[] ?? []), link] });
      }
      return { ok: true };
    }
  },
  tabs: {
    onCreated: { addListener() {} },
    create: async ({ url }) => {
      const id = ++nextTab;
      const clean = new URL(url).origin + new URL(url).pathname;
      const saved = virtualHistory.get(clean);
      const snapshot = collectChat(document, "https://chatgpt.com/c/demo-main");
      virtualTabs.set(id, saved ? structuredClone(saved) : { url: clean, key: snapshot.conversationKey, title: snapshot.title, generating: false, composerReady: true, answers: snapshot.answers.map((answer) => ({ id: answer.id, question: answer.question, text: answer.text, markdown: projectMarkdown(answer.contentElement) })) });
      const nodes = new Map<string, HTMLElement>();
      for (const answer of virtualTabs.get(id)!.answers) if (answer.content?.some((part) => part.type === 'native')) nodes.set(answer.id, createDemoLab(answer.id));
      surfaces.set(id, nodes);
      bridges.set(id, createSurfaceBridge((messageId) => nodes.get(messageId), () => virtualTabs.get(id)?.key ?? null));
      setTimeout(() => void simulateNative(id), 250);
      return { id };
    },
    sendMessage: async (id, message) => bridges.get(id)?.read(message) ?? { ok: false, error: "模拟源界面尚未加载" },
    get: async (id) => { if (!virtualTabs.has(id)) throw new Error("Demo tab closed"); return { id }; },
    update: async (id) => ({ id })
  }
};
const treeCoordinator = createTreeCoordinator(api);
async function simulateNative(id: number) {
  const report = virtualTabs.get(id);
  if (!report) return;
  const result = await treeCoordinator.handle({ type: "native:report", report }, id);
  if (!result.ok || result.managed === false) return;
  if (result.command) {
    const command = result.command;
    if (command.type === "fork") {
      report.answers = report.answers.slice(0, report.answers.findIndex((turn) => turn.id === command.messageId) + 1);
      const key = `demo-branch-${crypto.randomUUID()}`;
      report.url = `https://chatgpt.com/c/${key}`;
      report.key = `chatgpt:${key}`;
      report.title = "本地模拟支线";
    } else {
      const text = `这是本地模拟回答，不是模型生成。\n\n本支线保留 ${report.answers.length} 条此前的回答。${report.answers.length > 1 ? `上一轮问题是：“${report.answers.at(-1)!.question.slice(-80)}”。` : "KV Cache 可理解为保留已有计算结果的书签，后续生成复用历史 Key/Value。"}\n\n你可以在卡片继续问、收起后再展开，或从本回答创建子支线；主线不会新增这些问题。`;
      const messageId = `message:${crypto.randomUUID()}`;
      const interactive = /交互|intelligen|实验|面板/i.test(command.text!);
      if (interactive) surfaces.get(id)!.set(messageId, createDemoLab(messageId));
      report.answers.push({ id: messageId, question: command.text!, text, markdown: text, ...(interactive ? { content: [{ type: 'markdown' as const, markdown: '这是本地模拟的交互回答，布局和控件由模拟原生分支提供。' }, { type: 'native' as const, index: 0, label: 'GPU 布局实验室' }, { type: 'markdown' as const, markdown: '你可以继续在此支线提问，返回主线后状态保留。' }] } : {}) });
    }
    virtualHistory.set(report.url, structuredClone(report));
    sessionStorage.setItem("lattice-demo-native-history", JSON.stringify([...virtualHistory]));
    await treeCoordinator.handle({ type: "native:ack", commandId: command.id }, id);
  }
  setTimeout(() => void simulateNative(id), 500);
}
Object.assign(globalThis, { chrome: api });
mountLattice(() => `https://chatgpt.com${location.pathname}`);

document.getElementById("demo-native-dialog")?.addEventListener("click", () => {
  const dialog = document.createElement("dialog");
  dialog.className = "demo-tool-dialog";
  const title = document.createElement("h2");
  title.textContent = "原生工具对话框";
  const body = document.createElement("p");
  body.textContent = "这是模拟的 ChatGPT 工具界面。Lattice 会暂时让出屏幕，关闭后恢复。";
  const close = document.createElement("button");
  close.textContent = "关闭原生弹窗";
  close.addEventListener("click", () => { dialog.close(); dialog.remove(); });
  dialog.append(title, body, close);
  document.body.append(dialog);
  dialog.showModal();
});

for (const button of document.querySelectorAll<HTMLButtonElement>(".native-more")) {
  button.addEventListener("click", () => {
    document.querySelector("[role='menu']")?.remove();
    const menu = document.createElement("div");
    menu.role = "menu";
    const action = document.createElement("button");
    action.role = "menuitem";
    action.textContent = "Branch in new chat";
    action.addEventListener("click", () => {
      const source = button.closest("article");
      let next = source?.nextElementSibling;
      while (next) { const current = next; next = current.nextElementSibling; current.remove(); }
      history.pushState(null, "", `/c/demo-branch-${Date.now()}`);
      document.title = "新的探索方向 - ChatGPT";
      menu.remove();
    });
    menu.append(action);
    document.body.append(menu);
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".native-copy, .native-code-copy")) button.addEventListener("click", () => { button.textContent = "已复制（演示）"; });
document.querySelector(".native-composer")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLTextAreaElement>(".native-composer textarea")!;
  if (!input.value.trim()) return;
  const transcript = document.querySelector(".native-transcript")!;
  for (const [role, text] of [["user", input.value], ["assistant", "这是一条演示回答。扩展会自动发现新增的原生消息，并保留输入框和原生按钮的交互。"]]) {
    const article = document.createElement("article");
    const message = document.createElement("div");
    message.dataset.messageAuthorRole = role;
    message.dataset.messageId = crypto.randomUUID();
    message.textContent = text;
    article.append(message);
    transcript.append(article);
  }
  input.value = "";
});

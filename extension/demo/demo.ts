import { mountLattice } from "../src/mount";
import { BRANCHES_KEY, confirmBranch, mutatePresentation, presentationKey, readPresentation } from "../src/presentation";
import type { ExtensionPlatform, StorageArea } from "../src/platform";
import type { BranchLink, ExtensionMessage, PendingBranch } from "../src/types";
import nativeStyles from "../public/native.css?inline";

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
const api: ExtensionPlatform = {
  storage: { local: storage, session: storage, onChanged: { addListener: (listener) => { listeners.add(listener); }, removeListener: (listener) => { listeners.delete(listener); } } },
  runtime: {
    onMessage: { addListener() {} },
    sendMessage: async (message: ExtensionMessage) => {
      if (message.type === "presentation:mutate") {
        const key = presentationKey(message.key);
        const presentation = mutatePresentation(readPresentation(data[key]), message.mutation);
        await storage.set({ [key]: presentation });
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
  tabs: { onCreated: { addListener() {} } }
};
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

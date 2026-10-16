import { activeMain, collectChat, findNativeBranchAction } from "./host";
import { conversationKey } from "./presentation";
import { request } from "./platform";
import type { NativeReport } from "./tree-types";

function visible(element: HTMLElement): boolean {
  if (element.closest("[hidden], [aria-hidden='true'], [data-app-shell-active-page='false']")) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
function name(element: HTMLElement) { return (element.getAttribute("aria-label") || element.textContent || "").trim(); }
function buttons() { return [...activeMain()?.querySelectorAll<HTMLButtonElement>("button") ?? []].filter(visible); }
function generating() { return buttons().some((button) => /^(stop( generating| streaming)?|停止(生成|流式传输)?)$/i.test(name(button)) || button.dataset.testid === "stop-button"); }
export function nativeComposer(): HTMLElement | null {
  const main = activeMain();
  const preferred = main?.querySelector<HTMLElement>("#prompt-textarea, [data-testid='prompt-textarea']");
  if (preferred && visible(preferred)) return preferred;
  const candidates = [...main?.querySelectorAll<HTMLElement>("textarea, [contenteditable='true']") ?? []].filter(visible);
  const labeled = candidates.filter((item) => /chatgpt|prompt|message|询问|提问|发送/i.test(`${item.getAttribute("aria-label") ?? ""} ${item.getAttribute("data-placeholder") ?? ""} ${item.getAttribute("placeholder") ?? ""}`));
  return labeled.length === 1 ? labeled[0] : candidates.length === 1 ? candidates[0] : null;
}

// A read-only projection of visible content. ReactMarkdown will render this
// without raw HTML. Native rich tools, approvals and files stay in their tab.
export function projectMarkdown(element: HTMLElement): string {
  const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, "\\$1");
  function visit(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
    if (!(node instanceof HTMLElement)) return "";
    if (node.matches("script, style, button, input, textarea, iframe, svg, [hidden], [aria-hidden='true']")) return "";
    const text = [...node.childNodes].map(visit).join("");
    if (node.tagName === "PRE") return `\n\n\`\`\`\n${node.textContent ?? ""}\n\`\`\`\n\n`;
    if (node.tagName === "CODE") return `\`${node.textContent ?? ""}\``;
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      try { const url = new URL(href ?? "", location.href); if (href && /^https?:$/.test(url.protocol)) return `[${text || url.hostname}](${url.href.replace(/\)/g, "%29")})`; } catch { /* Keep plain text for unsafe URLs. */ }
    }
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${text}**`;
    if (node.tagName === "EM" || node.tagName === "I") return `*${text}*`;
    if (/^H[1-6]$/.test(node.tagName)) return `\n\n${"#".repeat(Number(node.tagName[1]))} ${text}\n\n`;
    if (node.tagName === "LI") return `\n- ${text.trim()}\n`;
    if (node.tagName === "BR") return "\n";
    if (["P", "DIV", "UL", "OL", "BLOCKQUOTE", "TABLE", "TR"].includes(node.tagName)) return `\n${text}\n`;
    return text;
  }
  return visit(element).replace(/\n{3,}/g, "\n\n").trim();
}

export function nativeReport(): NativeReport {
  const snapshot = collectChat();
  return { url: snapshot.url, key: snapshot.conversationKey, title: snapshot.title, generating: generating(), composerReady: !!nativeComposer() && !snapshot.nativeOverlay, answers: snapshot.answers.map((answer) => ({ id: answer.id, question: answer.question, text: answer.text, markdown: projectMarkdown(answer.contentElement) })) };
}

export async function sendNativePrompt(key: string, text: string, route?: string): Promise<void> {
  const matches = () => route ? new URL(location.href).origin + new URL(location.href).pathname === route : conversationKey(location.href) === key;
  if (!matches()) throw new Error("原生支线已经切换，未发送问题。");
  if (generating() || collectChat().nativeOverlay) throw new Error("原生页面正在生成或等待确认，请打开原生分支查看。");
  const editor = nativeComposer();
  if (!editor) throw new Error("未识别原生输入框，请打开原生分支继续。");
  const existing = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText ?? editor.textContent ?? "";
  if (existing.trim()) throw new Error("原生输入框已有草稿，未覆盖或发送。请打开原生分支核对。");
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  } else if (!document.execCommand("insertText", false, text)) {
    throw new Error("无法填写原生输入框，请打开原生分支继续。");
  }
  const normalized = (value: string) => value.replace(/\s+/g, "");
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    // Native rich editors represent inserted line breaks as separate blocks.
    // Read after their input handling settles; compare words independently of
    // the browser's innerText paragraph spacing, retaining the exact insertion.
    const actual = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText ?? editor.textContent ?? "";
    const sends = buttons().filter((button) => !button.disabled && (button.dataset.testid === "send-button" || /^(send( message| prompt)?|发送(消息|提示)?)$/i.test(name(button))));
    if (normalized(actual) === normalized(text) && sends.length === 1) {
      if (!matches()) throw new Error("页面已切换，未发送。");
      sends[0].click();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("未识别原生发送按钮，问题保留在原生草稿中，未自动重试。");
}

export function startNativeRelay() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let managed = false;
  let helloAttempts = 0;
  async function tick() {
    try {
      if (!managed) {
        const response = await request({ type: "native:hello" });
        managed = !!response.managed;
        if (!managed) {
          if (location.hash.startsWith("#lattice-worker=") && helloAttempts++ < 15) timer = setTimeout(() => void tick(), 500);
          return;
        }
        document.documentElement.dataset.latticeWorker = "true";
      }
      const response = await request({ type: "native:report", report: nativeReport() });
      if (response.managed === false) return;
      if (response.command) {
        const command = response.command;
        let error: string | undefined;
        try {
          if (command.type === "fork") {
            const answer = collectChat().answers.find((item) => item.id === command.messageId);
            if (conversationKey(location.href) !== command.key || !answer) throw new Error("分支起点尚未加载，请打开原生页面核对。");
            const action = await findNativeBranchAction(answer);
            if (!action) throw new Error("未识别原生分支菜单，请打开原生页面检查。没有调用替代模型或接口。");
            action.click();
          } else await sendNativePrompt(command.key, command.text!, command.route);
        } catch (cause) { error = cause instanceof Error ? cause.message : "原生页面操作失败。"; }
        await request({ type: "native:ack", commandId: command.id, ...(error ? { error } : {}) });
      }
    } catch (cause) {
      if (cause instanceof Error && /context invalidated|扩展已更新/i.test(cause.message)) stopped = true;
      // A native navigation can interrupt one poll; it must not replay commands.
    }
    if (!stopped) timer = setTimeout(() => void tick(), 900);
  }
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}

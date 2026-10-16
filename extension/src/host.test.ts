import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import currentChat from "../fixtures/current-chat.html?raw";
import { collectChat, decorateAnswers, excerptRange, findNativeBranchAction } from "./host";

const href = "https://chatgpt.com/c/source-chat";
beforeEach(() => {
  document.body.innerHTML = `<main><article><div data-message-author-role="user" data-message-id="u1">A question</div></article><article data-turn-id="t1"><div data-message-author-role="assistant" data-message-id="a1"><p>A <strong>native answer</strong> with <a href="https://example.org">citation</a>.</p><button>Copy code</button></div><button aria-label="More actions">More</button></article></main>`;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ChatGPT DOM adapter", () => {
  it("reads the current native message structure without headings, controls or sidebar content", () => {
    document.body.innerHTML = currentChat;
    const [answer] = collectChat(document, href).answers;
    expect(collectChat(document, href).answers).toHaveLength(1);
    expect(answer.id).toBe("message:answer-current");
    expect(answer.stableId).toBe(true);
    expect(answer.question).toBe("Keep current native features");
    expect(answer.text).toBe("Current native answer with a citation.");
    const content = document.querySelector("[data-chatgpt-selection-message-id]")!;
    expect(answer.element).toBe(content);
    expect(answer.contentElement).toBe(content);
    const html = content.innerHTML;
    const parent = content.parentNode;
    const cleanup = decorateAnswers([answer], true, answer.id);
    const turn = document.querySelector("main [data-chatgpt-search-unit-key$=':assistant']")!;
    turn.setAttribute("data-chatgpt-search-unit-key", "fallback-turn-7:9:assistant");
    content.querySelector("p")!.append(" Streaming update.");
    const updated = collectChat(document, href).answers[0];
    expect(updated.id).toBe(answer.id);
    expect(updated.text).toContain("Streaming update.");
    expect(content.parentNode).toBe(parent);
    content.querySelector("p")!.lastChild!.remove();
    expect(content.innerHTML).toBe(html);
    cleanup();
    expect(content.hasAttribute("data-lattice-answer")).toBe(false);
  });

  it("uses real message IDs rather than a positional search-unit key", () => {
    document.body.innerHTML = currentChat;
    const unit = document.querySelector("main [data-chatgpt-search-unit-key$=':assistant']")!;
    document.querySelector("[data-chatgpt-selection-message-id]")!.removeAttribute("data-chatgpt-selection-message-id");
    const answer = collectChat(document, href).answers[0];
    expect(answer.id).toBe("message:answer-current");
    expect(answer.text).not.toContain("ChatGPT said:");
    unit.removeAttribute("data-chatgpt-search-message-ids");
    expect(collectChat(document, href).answers[0].stableId).toBe(false);
  });

  it("does not fall back to a cached chat when the active page is a new empty conversation", () => {
    document.body.innerHTML = currentChat;
    document.querySelector("[data-app-shell-active-page='true']")!.innerHTML = "<div>New chat composer</div>";
    expect(collectChat(document, "https://chatgpt.com/").answers).toHaveLength(0);
  });

  it("retains separate IDs for multiple assistant messages within a rendered turn", () => {
    document.body.innerHTML = currentChat;
    const message = document.querySelector("[data-chatgpt-selection-message-id]")!;
    const next = message.cloneNode(true) as HTMLElement;
    next.setAttribute("data-chatgpt-selection-message-id", "answer-next");
    message.after(next);
    expect(collectChat(document, href).answers.map((answer) => answer.id)).toEqual(["message:answer-current", "message:answer-next"]);
  });

  it("finds the current turn's native branch menu outside its message content", async () => {
    document.body.innerHTML = currentChat;
    document.getElementById("current-native-action")!.addEventListener("pointerdown", () => {
      const menu = document.createElement("div");
      menu.role = "menu";
      menu.innerHTML = '<button role="menuitem">创建对话分支</button>';
      menu.firstElementChild!.addEventListener("click", () => {
        const child = document.createElement("div");
        child.role = "menu";
        child.innerHTML = '<button role="menuitem">在工作模式中创建分支</button><button role="menuitem">在新聊天中创建分支</button>';
        document.body.append(child);
      });
      document.body.append(menu);
    });
    const action = await findNativeBranchAction(collectChat(document, href).answers[0]);
    expect(action?.textContent).toBe("在新聊天中创建分支");
  });

  it("preserves native nodes, citations and event handlers across styling and streaming updates", () => {
    const snapshot = collectChat(document, href);
    const answer = snapshot.answers[0];
    const link = answer.element.querySelector("a")!;
    const button = answer.element.querySelector("button")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    const parent = answer.element.parentNode;
    const original = answer.element.innerHTML;
    const cleanup = decorateAnswers(snapshot.answers, true, answer.id);
    expect(answer.element.innerHTML).toBe(original);
    expect(answer.element.parentNode).toBe(parent);
    expect(answer.element.querySelector("a")).toBe(link);
    expect(link.getAttribute("href")).toBe("https://example.org");
    button.click();
    expect(clicked).toHaveBeenCalledOnce();
    answer.element.querySelector("p")!.append(" Streamed text.");
    const next = collectChat(document, href).answers[0];
    expect(next.id).toBe(answer.id);
    expect(next.question).toBe("A question");
    expect(next.text).toContain("Streamed text.");
    cleanup();
    expect(answer.element.hasAttribute("data-lattice-answer")).toBe(false);
  });

  it("does not treat positional DOM indexes as persistent message IDs", () => {
    document.body.innerHTML = `<main><article data-testid="conversation-turn-0"><div data-message-author-role="assistant">Unknown identity</div></article></main>`;
    const first = collectChat(document, href).answers[0];
    expect(first.stableId).toBe(false);
    expect(collectChat(document, href).answers[0].id).toBe(first.id);
  });
  it("detects native modal surfaces so the workspace can yield the screen", () => {
    const dialog = document.createElement("div");
    dialog.role = "dialog";
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(collectChat(document, href).nativeOverlay).toBe(true);
    dialog.hidden = true;
    expect(collectChat(document, href).nativeOverlay).toBe(false);
  });

  it("keeps excerpts anchored across inline markup and refuses ambiguous changed quotes", () => {
    const answer = collectChat(document, href).answers[0];
    const text = "native answer";
    const startOffset = answer.element.textContent!.indexOf(text);
    const excerpt = { id: "e", messageId: answer.id, text, startOffset, endOffset: startOffset + text.length, note: "", createdAt: "2026-10-16" };
    expect(excerptRange(answer, excerpt)?.toString()).toBe(text);
    answer.element.prepend(document.createTextNode("prefix "));
    expect(excerptRange(answer, excerpt)?.toString()).toBe(text);
    answer.element.append(document.createTextNode(text));
    expect(excerptRange(answer, excerpt)).toBeNull();
  });

  it("uses only the selected answer's native menu and does not trigger a model request", async () => {
    const answer = collectChat(document, href).answers[0];
    const native = vi.fn();
    document.querySelector("[aria-label='More actions']")!.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.role = "menu";
      const item = document.createElement("button");
      item.role = "menuitem";
      item.textContent = "Branch in new chat";
      item.addEventListener("click", native);
      menu.append(item);
      document.body.append(menu);
    });
    const action = await findNativeBranchAction(answer);
    expect(action?.textContent).toBe("Branch in new chat");
    expect(native).not.toHaveBeenCalled();
    action!.click();
    expect(native).toHaveBeenCalledOnce();
  });

  it("degrades to navigation if no recognized native branch action exists", async () => {
    document.querySelector("[aria-label='More actions']")!.remove();
    expect(await findNativeBranchAction(collectChat(document, href).answers[0], 10)).toBeNull();
  });
  it("does not use an unrelated menu that was already open", async () => {
    const menu = document.createElement("div");
    menu.role = "menu";
    menu.innerHTML = '<button role="menuitem">Branch in new chat</button>';
    document.body.append(menu);
    const native = vi.fn();
    menu.firstElementChild!.addEventListener("click", native);
    expect(await findNativeBranchAction(collectChat(document, href).answers[0], 5)).toBeNull();
    expect(native).not.toHaveBeenCalled();
  });
});

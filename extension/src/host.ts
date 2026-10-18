import { selectionFromContainer } from "../../src/lib/selection";
import { conversationKey } from "./presentation";
import type { ChatSnapshot, Excerpt, NativeAnswer } from "./types";
import { hasNativeInteractive, indexText, NATIVE_INTERACTIVE } from "./native-content";

const ROLE = "[data-message-author-role]";
const SEARCH_UNIT = "[data-chatgpt-search-unit-key]";
const SELECTION_MESSAGE = "[data-chatgpt-selection-message-id]";
const TURN = "article, [data-turn-id], [data-talvt-turn-state]";
const ephemeralIds = new WeakMap<HTMLElement, string>();

function messageIdentity(element: HTMLElement): { id: string; stableId: boolean } {
  const messageId = element.closest("[data-message-id]")?.getAttribute("data-message-id")
    || element.getAttribute("data-chatgpt-selection-message-id");
  if (messageId) return { id: `message:${messageId}`, stableId: true };
  // Search-unit keys can contain positional `fallback-turn-*` values. Only the
  // actual message IDs are persistent; one unit may list the same ID twice.
  const searchIds = [...new Set((element.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids") ?? "").split(/\s+/).filter(Boolean))];
  if (searchIds.length === 1) return { id: `message:${searchIds[0]}`, stableId: true };
  const turn = element.closest<HTMLElement>("[data-turn-id], article[data-testid^='conversation-turn-']");
  const turnId = turn?.getAttribute("data-turn-id") || turn?.id;
  if (turnId && turn?.querySelectorAll(ROLE).length === 1) return { id: `turn:${turnId}`, stableId: true };
  let id = ephemeralIds.get(element);
  if (!id) { id = `ephemeral:${crypto.randomUUID()}`; ephemeralIds.set(element, id); }
  return { id, stableId: false };
}

export function activeMain(documentRoot = document) {
  const activePage = documentRoot.querySelector("[data-app-shell-active-page='true']");
  return activePage ? activePage.querySelector("main") : [...documentRoot.querySelectorAll("main")].find((element) => !element.closest("[data-app-shell-active-page='false'], [hidden], [aria-hidden='true']"));
}

export function collectChat(documentRoot = document, href = location.href): ChatSnapshot {
  const main = activeMain(documentRoot);
  const answers: NativeAnswer[] = [];
  let question = "";
  const seen = new Set<string>();
  for (const element of main?.querySelectorAll<HTMLElement>(`${ROLE}, ${SEARCH_UNIT}`) ?? []) {
    if (element.parentElement?.closest(ROLE) || element.closest("[hidden], [aria-hidden='true']")) continue;
    const legacyRole = element.getAttribute("data-message-author-role");
    if (!legacyRole && (element.parentElement?.closest(SEARCH_UNIT) || element.querySelector(ROLE))) continue;
    const role = legacyRole || element.getAttribute("data-chatgpt-search-unit-key")?.match(/:(user|assistant)$/)?.[1];
    if (role === "user") {
      const content = legacyRole ? element : element.querySelector<HTMLElement>("[data-content-search-unit-key]") ?? element;
      question = indexText(content);
      continue;
    }
    if (role !== "assistant") continue;
    const selectionMessages = legacyRole ? [] : [...element.querySelectorAll<HTMLElement>(SELECTION_MESSAGE)].filter((message) => !message.parentElement?.closest(SELECTION_MESSAGE));
    // Current ChatGPT puts its screen-reader heading outside the message body.
    // Keep that heading out of excerpts, and retain each real message's identity.
    const messages = selectionMessages.length ? selectionMessages : [element];
    for (const message of messages) {
      if (message.closest("[hidden], [aria-hidden='true']")) continue;
      const identity = messageIdentity(message);
      if (seen.has(identity.id)) continue;
      seen.add(identity.id);
      const heading = !legacyRole && message === element ? element.querySelector<HTMLElement>("[data-conversation-role='assistant']") : null;
      const contentElement = heading?.nextElementSibling instanceof HTMLElement ? heading.nextElementSibling : message;
      answers.push({ ...identity, question, text: indexText(contentElement), element: message, contentElement, nativeInteractive: hasNativeInteractive(contentElement) });
    }
  }
  const url = new URL(href);
  const key = conversationKey(href);
  const nativeOverlay = [...documentRoot.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true'], dialog[open]")].some((dialog) => available(dialog) && getComputedStyle(dialog).display !== "none" && getComputedStyle(dialog).visibility !== "hidden");
  return {
    route: url.origin + url.pathname,
    conversationKey: key,
    url: url.origin + url.pathname,
    title: documentRoot.title.replace(/\s*[-–|]\s*ChatGPT\s*$/, "").trim() || question.slice(0, 80) || "当前对话",
    answers,
    nativeOverlay
  };
}

export function observeChat(onChange: (snapshot: ChatSnapshot) => void, getHref = () => location.href): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let previousRoute = getHref();
  let previous: ChatSnapshot | undefined;
  function update() {
    clearTimeout(timer);
    timer = undefined;
    if (stopped) return;
    const next = collectChat(document, getHref());
    const sameAnswers = previous && next.answers.length === previous.answers.length && next.answers.every((answer, index) => {
      const old = previous!.answers[index];
      return answer.id === old.id && answer.stableId === old.stableId && answer.question === old.question && answer.text === old.text && answer.element === old.element && answer.contentElement === old.contentElement && answer.nativeInteractive === old.nativeInteractive;
    });
    if (sameAnswers) next.answers = previous!.answers;
    if (sameAnswers && next.route === previous!.route && next.title === previous!.title && next.nativeOverlay === previous!.nativeOverlay) return;
    previous = next;
    onChange(next);
  }
  const dialogSelector = "dialog[open], [role='dialog'][aria-modal='true']";
  const contains = (node: Node, selector: string) => node instanceof Element && (node.matches(selector) || !!node.querySelector(selector));
  const observer = new MutationObserver((records) => {
    const main = activeMain();
    const relevant = records.some((record) => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!element || element.closest("#lattice-chatgpt-extension, [data-lattice-tree-host]")) return false;
      if (record.type === "attributes" && record.attributeName === "data-app-shell-active-page") return true;
      // Native modal portals must still make the workspace yield, including a
      // dialog opened from a native application. Ordinary widget state is inert.
      if (record.type === "attributes" && ["role", "aria-modal", "open", "hidden", "aria-hidden"].includes(record.attributeName!)) {
        if (record.attributeName === "role" && record.oldValue === "dialog") return true;
        if (element.matches("dialog, [role='dialog']") || element.querySelector(dialogSelector)) return true;
      }
      if (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some((node) => contains(node, dialogSelector) || contains(node, "main, [data-app-shell-active-page]"))) return true;
      if (element.closest("title")) return true;
      if (element === document.head && record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some((node) => contains(node, "title"))) return true;
      if (!main?.contains(element)) return false;
      if (record.type === "attributes" && ["data-dil-message-id", "data-dil-source-message-id"].includes(record.attributeName!)) return true;
      if (element.closest(NATIVE_INTERACTIVE)) return false;
      // Composer typing, toolbars and unrelated native navigation are not
      // message changes. Structural insertions still discover streamed turns.
      return !!element.closest(`${ROLE}, ${SEARCH_UNIT}`) || record.type === "attributes" && ["data-message-author-role", "data-chatgpt-search-unit-key"].includes(record.attributeName!) || record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some((node) => contains(node, `${ROLE}, ${SEARCH_UNIT}`));
    });
    if (!relevant) return;
    // Throttle rather than debounce: keep navigation usable during a long stream.
    if (!timer) timer = setTimeout(update, 180);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ["data-app-shell-active-page", "data-message-id", "data-message-author-role", "data-turn-id", "data-testid", "data-chatgpt-search-unit-key", "data-chatgpt-search-message-ids", "data-chatgpt-selection-message-id", "data-conversation-role", "data-dil-message-id", "data-dil-source-message-id", "hidden", "aria-hidden", "aria-modal", "open", "role"] });
  if (document.head) observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  const routeTimer = setInterval(() => {
    if (getHref() !== previousRoute) { previousRoute = getHref(); update(); }
  }, 500);
  window.addEventListener("popstate", update);
  window.addEventListener("hashchange", update);
  update();
  return () => { stopped = true; observer.disconnect(); clearTimeout(timer); clearInterval(routeTimer); window.removeEventListener("popstate", update); window.removeEventListener("hashchange", update); };
}

export function decorateAnswers(answers: NativeAnswer[], enabled: boolean, activeId: string | null): () => void {
  const decorator = createAnswerDecorator();
  decorator.update(answers, enabled, activeId);
  return decorator.dispose;
}

export function createAnswerDecorator() {
  let decorated = new Set<HTMLElement>();
  const set = (element: HTMLElement, name: string, value: string) => { if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
  const remove = (element: HTMLElement) => { element.removeAttribute("data-lattice-answer"); element.removeAttribute("data-lattice-active"); };
  return {
    update(answers: NativeAnswer[], enabled: boolean, activeId: string | null) {
      set(document.documentElement, "data-lattice-cards", String(enabled));
      const next = new Set<HTMLElement>();
      for (const answer of answers) {
        if (answer.nativeInteractive) continue;
        next.add(answer.element);
        set(answer.element, "data-lattice-answer", "");
        set(answer.element, "data-lattice-active", String(enabled && answer.id === activeId));
      }
      for (const element of decorated) if (!next.has(element)) remove(element);
      decorated = next;
    },
    dispose() { document.documentElement.removeAttribute("data-lattice-cards"); for (const element of decorated) remove(element); decorated.clear(); }
  };
}

export function jumpToAnswer(answer: NativeAnswer): void {
  answer.element.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

export function getAnswerSelection(answers: NativeAnswer[]) {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.toString().trim()) return null;
  const answer = answers.find((item) => item.contentElement.contains(selection.anchorNode));
  if (!answer) return null;
  const resolved = selectionFromContainer(answer.contentElement, "", selection);
  if (!resolved || !selection.rangeCount) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return { answer, ...resolved, anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
}

export function excerptRange(answer: Pick<NativeAnswer, "contentElement">, excerpt: Excerpt): Range | null {
  const content = answer.contentElement.textContent ?? "";
  let start = excerpt.startOffset;
  if (content.slice(start, excerpt.endOffset) !== excerpt.text) {
    start = content.indexOf(excerpt.text);
    // Do not silently attach a changed or repeated quote to the wrong occurrence.
    if (start < 0 || content.indexOf(excerpt.text, start + 1) !== -1) return null;
  }
  const end = start + excerpt.text.length;
  const walker = document.createTreeWalker(answer.contentElement, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (!started && offset + length > start) { range.setStart(node, start - offset); started = true; }
    if (started && offset + length >= end) { range.setEnd(node, end - offset); return range; }
    offset += length;
  }
  return null;
}

const BRANCH_LABEL = /^(branch in (a )?new chat|在新(聊天|对话)中(创建)?分支|新(聊天|对话)中的分支|分支(到|至)新(聊天|对话))$/i;
const BRANCH_SUBMENU = /^(创建(对话|聊天)分支|branch( conversation)?)$/i;
const MORE_LABEL = /^(more( actions| options)?|更多(操作|选项)?)$/i;
function accessibleName(element: HTMLElement): string {
  return (element.getAttribute("aria-label") || element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
}
function available(element: HTMLElement): boolean {
  return !element.matches(":disabled, [aria-disabled='true']") && !element.closest("[data-app-shell-active-page='false'], [hidden], [aria-hidden='true']");
}

export async function findNativeBranchAction(answer: NativeAnswer, timeout = 1800): Promise<HTMLElement | null> {
  const turn = answer.element.closest<HTMLElement>(TURN);
  if (!turn?.isConnected) return null;
  jumpToAnswer(answer);
  const controls = [...turn.querySelectorAll<HTMLElement>("button, [role='button']")].filter((button) => !answer.contentElement.contains(button) && available(button));
  const direct = controls.find((button) => BRANCH_LABEL.test(accessibleName(button)));
  if (direct) return direct;
  const more = controls.find((button) => MORE_LABEL.test(accessibleName(button)));
  if (!more) return null;
  const previousMenus = new Set(document.querySelectorAll("[role='menu']"));
  // Native menu triggers can open on pointerdown (e.g. Radix), while other
  // versions use click. Dispatch the same sequence as a primary mouse click.
  const PointerInput = window.PointerEvent ?? MouseEvent;
  more.dispatchEvent(new PointerInput("pointerdown", { bubbles: true, composed: true, button: 0, buttons: 1, pointerType: "mouse", isPrimary: true }));
  more.dispatchEvent(new PointerInput("pointerup", { bubbles: true, composed: true, button: 0, buttons: 0, pointerType: "mouse", isPrimary: true }));
  more.click();
  let submenu: HTMLElement | undefined;
  let submenuOpened = false;
  let beforeSubmenus = new Set<Element>();
  const find = () => {
    const controlledId = more.getAttribute("aria-controls");
    const menus = [...document.querySelectorAll<HTMLElement>("[role='menu']")].filter((menu) => available(menu) && (controlledId ? menu.id === controlledId : !previousMenus.has(menu) || (!!more.id && menu.getAttribute("aria-labelledby") === more.id)));
    if (!submenu && menus.length !== 1) return null;
    const owned = submenu ? [...menus, ...[...document.querySelectorAll<HTMLElement>("[role='menu']")].filter((menu) => available(menu) && (!beforeSubmenus.has(menu) || menu.id === submenu?.getAttribute("aria-controls")))] : menus;
    const items = owned.flatMap((menu) => [...menu.querySelectorAll<HTMLElement>("[role='menuitem'], button")]);
    const action = items.find((element) => BRANCH_LABEL.test(accessibleName(element)) && available(element));
    if (action) return action;
    if (!submenuOpened) {
      submenu = items.find((element) => BRANCH_SUBMENU.test(accessibleName(element)) && available(element));
      if (submenu) {
        submenuOpened = true;
        beforeSubmenus = new Set(document.querySelectorAll("[role='menu']"));
        submenu.focus();
        submenu.click();
        submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
      }
    }
    return null;
  };
  const existing = find();
  if (existing) return existing;
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => { const action = find(); if (action) finish(action); });
    const timer = setTimeout(() => finish(null), timeout);
    function finish(value: HTMLElement | null) { observer.disconnect(); clearTimeout(timer); resolve(value); }
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "data-state", "aria-expanded"] });
    const action = find();
    if (action) finish(action);
  });
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/intelligent-chat.html?raw";
import { collectChat, createAnswerDecorator, observeChat } from "./host";
import { INTERACTIVE_TEXT } from "./native-content";
import { nativeComposer, nativeReport, projectMarkdown } from "./native-relay";

let stop: (() => void) | undefined;
beforeEach(() => { document.body.innerHTML = fixture; vi.useFakeTimers(); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const flush = async () => { await vi.advanceTimersByTimeAsync(250); };

describe("native Intelligent UI isolation", () => {
  it("indexes prose without forcing layout or traversing the native application", () => {
    const surface = document.querySelector<HTMLElement>("[data-dil-source-message-id]")!;
    Object.defineProperty(surface, "childNodes", { get: () => { throw new Error("Visited the application's internal tree"); } });
    const innerText = vi.fn(() => { throw new Error("Forced layout"); });
    for (const node of document.querySelectorAll("*")) Object.defineProperty(node, "innerText", { configurable: true, get: innerText });
    const answer = collectChat().answers[0];
    expect(answer.nativeInteractive).toBe(true);
    expect(answer.text).toContain("The layout experiment is ready.");
    expect(answer.text).toContain(INTERACTIVE_TEXT);
    expect(answer.text).not.toContain("42% peak");
    expect(innerText).not.toHaveBeenCalled();
    expect(projectMarkdown(answer.contentElement)).toContain("[原生交互内容]");
  });

  it("keeps native controls and geometry attributes untouched during repeated decoration", async () => {
    const answer = collectChat().answers[0];
    const original = answer.element.outerHTML;
    const button = document.getElementById("tile")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    const decorator = createAnswerDecorator();
    decorator.update([answer], true, answer.id);
    for (let i = 0; i < 20; i++) decorator.update(collectChat().answers, true, answer.id);
    expect(answer.element.outerHTML).toBe(original);
    button.click();
    expect(clicked).toHaveBeenCalledOnce();
    // Plain-text answers also avoid remove/re-add layout invalidation.
    document.querySelector("[data-dil-source-message-id]")!.remove();
    decorator.update(collectChat().answers, true, null);
    const changes = vi.fn();
    const observer = new MutationObserver(changes);
    observer.observe(answer.element, { attributes: true });
    decorator.update(collectChat().answers, true, null);
    await flush();
    expect(changes).not.toHaveBeenCalled();
    observer.disconnect();
    decorator.dispose();
  });

  it("does not rescan or publish during live widget animations, composer typing, or sidebar changes", async () => {
    const publish = vi.fn();
    stop = observeChat(publish);
    expect(publish).toHaveBeenCalledOnce();
    const surface = document.querySelector<HTMLElement>("[data-dil-message-id]")!;
    const textReads = vi.spyOn(Node.prototype, "textContent", "get");
    textReads.mockClear();
    for (let frame = 0; frame < 20; frame++) {
      document.getElementById("counter")!.firstChild!.nodeValue = `${frame}% peak`;
      surface.querySelector("button")!.setAttribute("role", frame % 2 ? "button" : "switch");
      document.getElementById("native-composer")!.append("Draft");
      document.body.append(document.createElement("aside"));
      await flush();
    }
    expect(publish).toHaveBeenCalledOnce();
    expect(textReads).not.toHaveBeenCalled();
    document.getElementById("prose")!.firstChild!.nodeValue = "An actual streamed answer update.";
    await flush();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0].answers[0].text).toContain("actual streamed answer");
  });

  it("keeps the last stable answer while Intelligent UI replaces a streaming turn", async () => {
    const publish = vi.fn();
    stop = observeChat(publish);
    const unit = document.querySelector<HTMLElement>("[data-chatgpt-search-unit-key$=':assistant']")!;
    const parent = unit.parentElement!;
    unit.remove();
    await flush();
    expect(publish).toHaveBeenCalledOnce();

    parent.append(unit);
    await flush();
    expect(publish).toHaveBeenCalledOnce();
    expect(collectChat().answers[0].text).toContain("The layout experiment is ready.");
  });

  it("deduplicates unchanged messages but still discovers replacements and new turns", async () => {
    const publish = vi.fn();
    stop = observeChat(publish);
    const prose = document.getElementById("prose")!;
    prose.replaceChildren(document.createTextNode(prose.textContent!));
    await flush();
    expect(publish).toHaveBeenCalledOnce();
    const answer = document.querySelector("[data-chatgpt-selection-message-id]")!;
    answer.replaceWith(answer.cloneNode(true));
    await flush();
    expect(publish).toHaveBeenCalledTimes(2);
    const next = document.createElement("article");
    next.innerHTML = '<div data-message-author-role="assistant" data-message-id="next">New main-line reply.</div>';
    document.querySelector("main")!.append(next);
    await flush();
    expect(publish.mock.lastCall![0].answers).toHaveLength(2);
  });

  it("continues to yield to native modals, and handles active-page navigation", async () => {
    const publish = vi.fn();
    stop = observeChat(publish);
    const dialog = document.createElement("div");
    dialog.role = "dialog";
    dialog.setAttribute("aria-modal", "true");
    document.querySelector("[data-dil-message-id]")!.append(dialog);
    await flush();
    expect(publish.mock.lastCall![0].nativeOverlay).toBe(true);
    dialog.removeAttribute("role");
    await flush();
    expect(publish.mock.lastCall![0].nativeOverlay).toBe(false);
    document.querySelector("[data-app-shell-active-page]")!.setAttribute("data-app-shell-active-page", "false");
    const page = document.createElement("section");
    page.dataset.appShellActivePage = "true";
    page.innerHTML = "<main>New empty conversation</main>";
    document.body.append(page);
    await flush();
    expect(publish.mock.lastCall![0].answers).toHaveLength(0);
  });

  it("never treats application buttons or editors as the native composer or generation controls", () => {
    expect(nativeComposer()?.id).toBe("native-composer");
    const report = nativeReport();
    expect(report.generating).toBe(false);
    expect(report.composerReady).toBe(true);
    expect(report.answers[0].markdown).not.toContain("42% peak");
    expect(report.answers[0].markdown).toContain("Continue discussing KV Cache");
  });

  it("tracks removed message identities and title changes without unrelated body mutations", async () => {
    const publish = vi.fn();
    stop = observeChat(publish);
    document.querySelector("[data-chatgpt-search-unit-key$=':assistant']")!.removeAttribute("data-chatgpt-search-unit-key");
    await flush();
    expect(publish.mock.lastCall![0].answers).toHaveLength(0);
    const oldTitle = document.title;
    document.title = "A renamed conversation - ChatGPT";
    await flush();
    expect(publish.mock.lastCall![0].title).toBe("A renamed conversation");
    document.title = oldTitle;
  });
});
